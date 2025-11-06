import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, SignatureStatus } from '@prisma/client';
import {
  Contract,
  JsonRpcProvider,
  Signature,
  Wallet,
  ZeroHash,
  getAddress,
  hexlify,
  randomBytes,
  verifyTypedData,
} from 'ethers';
import SplitCoordinatorArtifact from '../../abi/SplitCoordinator.json';
import IERC20Artifact from '../../abi/IERC20.json';
import { PrismaService } from 'src/prisma/prisma.service';
import { CreateSplitDto } from './dto/create-split.dto';
import { ApproveIntentDto } from './dto/approve-intent.dto';
import { SubmitSignatureDto } from './dto/submit-signature.dto';
import { SettleSplitDto, SettleItemDto } from './dto/settle-split.dto';

const APPROVE_SPLIT_TYPES: Record<string, { name: string; type: string }[]> = {
  ApproveSplit: [
    { name: 'participant', type: 'address' },
    { name: 'splitId', type: 'uint256' },
    { name: 'token', type: 'address' },
    { name: 'payer', type: 'address' },
    { name: 'amount', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
    { name: 'salt', type: 'bytes32' },
  ],
};

type SplitWithRelations = Prisma.SplitGetPayload<{
  include: { participants: true; signatures: true };
}>;

interface PreparedSignatureItem {
  participant: string;
  amount: bigint;
  deadline: bigint;
  salt: string;
  signature: string;
  signatureRecordId: number;
}

@Injectable()
export class SplitsService {
  private readonly chainId: number;
  private readonly contractAddress: string;
  private readonly eip712Name: string;
  private readonly eip712Version: string;
  private readonly provider: JsonRpcProvider;
  private readonly readContract: Contract;
  private readonly executorWallet?: Wallet;
  private readonly writeContract?: Contract;

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {
    const chainIdRaw = this.configService.get<string>('CHAIN_ID');
    if (!chainIdRaw) {
      throw new Error('CHAIN_ID não configurado');
    }
    const chainId = Number(chainIdRaw);
    if (!Number.isInteger(chainId) || chainId <= 0) {
      throw new Error('CHAIN_ID inválido');
    }
    this.chainId = chainId;

    const contractEnv = this.configService.get<string>('SPLIT_COORDINATOR_ADDRESS');
    if (!contractEnv) {
      throw new Error('SPLIT_COORDINATOR_ADDRESS não configurado');
    }
    this.contractAddress = getAddress(contractEnv);

    this.eip712Name = this.configService.get<string>('EIP712_NAME') ?? 'Accountant';
    this.eip712Version = this.configService.get<string>('EIP712_VERSION') ?? '1';

    const rpcUrl = this.configService.get<string>('RPC_URL_SCROLL');
    if (!rpcUrl) {
      throw new Error('RPC_URL_SCROLL não configurado');
    }
    this.provider = new JsonRpcProvider(rpcUrl);

    this.readContract = new Contract(
      this.contractAddress,
      SplitCoordinatorArtifact.abi,
      this.provider,
    );

    const executorPrivateKey = this.configService.get<string>('EXECUTOR_PRIVATE_KEY');
    if (executorPrivateKey) {
      this.executorWallet = new Wallet(executorPrivateKey, this.provider);
      this.writeContract = new Contract(
        this.contractAddress,
        SplitCoordinatorArtifact.abi,
        this.executorWallet,
      );
    }
  }

  async createSplit(dto: CreateSplitDto) {
    const payer = getAddress(dto.payer);
    const token = getAddress(dto.token);

    const legs = dto.legs.map((leg) => ({
      participant: getAddress(leg.participant),
      amount: BigInt(leg.amount),
    }));

    if (legs.length === 0) {
      throw new BadRequestException('Ao menos um participante é necessário');
    }

    for (const leg of legs) {
      if (leg.amount <= 0n) {
        throw new BadRequestException('amount deve ser > 0');
      }
    }

    const participantsSet = new Set(legs.map((leg) => leg.participant));
    if (participantsSet.size !== legs.length) {
      throw new ConflictException('Participantes duplicados detectados');
    }

    const totalAmount = legs.reduce((acc, leg) => acc + leg.amount, 0n);
    if (totalAmount <= 0n) {
      throw new BadRequestException('totalAmount calculado inválido');
    }

    const deadlineDate = dto.deadline ? this.parseIsoDeadline(dto.deadline) : null;
    const metaHashBytes =
      dto.metaHash && dto.metaHash !== '0x'
        ? Buffer.from(dto.metaHash.slice(2), 'hex')
        : null;

    const split = await this.prisma.split.create({
      data: {
        chainId: this.chainId,
        contract: this.contractAddress,
        payer,
        token,
        totalAmount: new Prisma.Decimal(totalAmount.toString()),
        deadline: deadlineDate,
        metaHash: metaHashBytes,
        participants: {
          create: legs.map((leg) => ({
            participant: leg.participant,
            amount: new Prisma.Decimal(leg.amount.toString()),
          })),
        },
      },
      include: {
        participants: true,
      },
    });

    let txHash: string | null = null;
    if (dto.createOnchain) {
      const contract = this.ensureWriteContract();
      const deadlineSeconds = deadlineDate
        ? BigInt(Math.floor(deadlineDate.getTime() / 1000))
        : 0n;
      const metaHash =
        metaHashBytes !== null ? `0x${metaHashBytes.toString('hex')}` : ZeroHash;

      try {
        const tx = await contract.createSplit(payer, token, legs, deadlineSeconds, metaHash);
        const receipt = await tx.wait();
        txHash = receipt.hash;

        let onchainId: bigint | undefined;
        for (const log of receipt.logs) {
          if (log.address.toLowerCase() !== this.contractAddress.toLowerCase()) {
            continue;
          }
          try {
            const parsed = this.readContract.interface.parseLog(log);
            if (parsed?.name === 'SplitCreated') {
              onchainId = BigInt(parsed.args.splitId.toString());
              break;
            }
          } catch {
            // Ignora logs não decodificados
          }
        }

        if (onchainId !== undefined) {
          await this.prisma.split.update({
            where: { id: split.id },
            data: { splitIdOnchain: onchainId },
          });
        }
      } catch (error) {
        await this.prisma.split.delete({ where: { id: split.id } }).catch(() => {
          // Ignora erro ao tentar limpar split parcialmente criado
        });
        throw new BadRequestException(
          `Falha ao criar split on-chain: ${(error as Error).message}`,
        );
      }
    }

    return {
      id: split.id,
      txHash,
    };
  }

  async generateApproveIntent(splitId: number, dto: ApproveIntentDto) {
    const split = await this.findSplitOrThrow(splitId);
    if (split.settled) {
      throw new BadRequestException('Split já liquidado');
    }

    const participant = getAddress(dto.participant);
    const participantLeg = split.participants.find(
      (leg) => leg.participant.toLowerCase() === participant.toLowerCase(),
    );
    if (!participantLeg) {
      throw new NotFoundException('Participante não encontrado neste split');
    }

    const { deadlineDate, deadlineUnix } = this.resolveApprovalDeadline(
      dto.deadline,
      split.deadline,
    );

    const saltBytes = randomBytes(32);
    const saltHex = hexlify(saltBytes);

    const splitIdValue = this.resolveSplitIdForSigning(split);
    const message = {
      participant,
      splitId: splitIdValue.toString(),
      token: split.token,
      payer: split.payer,
      amount: participantLeg.amount.toString(),
      deadline: deadlineUnix.toString(),
      salt: saltHex,
    };

    await this.prisma.splitSignature.create({
      data: {
        splitId: split.id,
        participant,
        amount: participantLeg.amount,
        deadline: deadlineDate,
        salt: Buffer.from(saltBytes),
        status: SignatureStatus.PENDING,
        signature: Buffer.alloc(0),
      },
    });

    return {
      domain: this.buildDomain(),
      types: APPROVE_SPLIT_TYPES,
      primaryType: 'ApproveSplit',
      message,
    };
  }

  async submitSignature(splitId: number, dto: SubmitSignatureDto) {
    const split = await this.findSplitOrThrow(splitId);
    if (split.settled) {
      throw new BadRequestException('Split já liquidado');
    }

    const participant = getAddress(dto.participant);
    const participantLeg = split.participants.find(
      (leg) => leg.participant.toLowerCase() === participant.toLowerCase(),
    );
    if (!participantLeg) {
      throw new NotFoundException('Participante não encontrado neste split');
    }

    if (participantLeg.amount.toString() !== dto.amount) {
      throw new BadRequestException('amount não corresponde ao valor da perna');
    }

    const saltHex = dto.salt.toLowerCase();
    const signatureRecord = split.signatures.find(
      (sig) =>
        sig.participant.toLowerCase() === participant.toLowerCase() &&
        this.bufferToHex(sig.salt)?.toLowerCase() === saltHex,
    );

    if (!signatureRecord) {
      throw new NotFoundException('Salt não encontrado para este participante');
    }

    if (signatureRecord.status === SignatureStatus.USED_ONCHAIN) {
      throw new ConflictException('Assinatura já utilizada on-chain');
    }

    if (signatureRecord.status === SignatureStatus.VALID) {
      return { ok: true };
    }

    const recordDeadlineUnix = signatureRecord.deadline
      ? BigInt(Math.floor(signatureRecord.deadline.getTime() / 1000))
      : 0n;

    if (dto.deadline) {
      const provided = this.parseDeadline(dto.deadline);
      if (provided.unix !== null && provided.unix !== recordDeadlineUnix) {
        throw new BadRequestException('deadline não corresponde ao intent registrado');
      }
    }

    const message = {
      participant,
      splitId: this.resolveSplitIdForSigning(split).toString(),
      token: split.token,
      payer: split.payer,
      amount: participantLeg.amount.toString(),
      deadline: recordDeadlineUnix.toString(),
      salt: saltHex,
    };

    const recovered = verifyTypedData(
      this.buildDomain(),
      APPROVE_SPLIT_TYPES,
      message,
      dto.signature,
    );

    if (recovered.toLowerCase() !== participant.toLowerCase()) {
      throw new BadRequestException('Assinatura inválida: signer diferente do participante');
    }

      if (recordDeadlineUnix !== 0n) {
        const nowUnix = BigInt(Math.floor(Date.now() / 1000));
        if (recordDeadlineUnix < nowUnix) {
          await this.prisma.splitSignature.update({
            where: { id: signatureRecord.id },
            data: {
              status: SignatureStatus.EXPIRED,
              reason: 'Assinatura expirada antes da validação',
            },
          });
          throw new BadRequestException('Assinatura expirada');
        }
    }

    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.splitSignature.update({
        where: { id: signatureRecord.id },
        data: {
          status: SignatureStatus.VALID,
          signature: Buffer.from(dto.signature.slice(2), 'hex'),
        },
      }),
      this.prisma.splitParticipant.update({
        where: {
          splitId_participant: {
            splitId: split.id,
            participant,
          },
        },
        data: {
          approvedOffchainAt: now,
        },
      }),
    ]);

    return { ok: true };
  }

  async settleSplit(splitId: number, dto: SettleSplitDto) {
    const split = await this.findSplitOrThrow(splitId);
    if (split.settled) {
      throw new BadRequestException('Split já liquidado');
    }

    const items = dto.items && dto.items.length > 0
      ? this.prepareItemsFromPayload(split, dto.items)
      : this.prepareItemsFromDatabase(split);

    if (items.length !== split.participants.length) {
      throw new BadRequestException('Número de assinaturas não corresponde aos participantes');
    }

    const contract = this.ensureWriteContract();
    const splitIdValue = this.resolveSplitIdForSigning(split);

    const participants = items.map((item) => item.participant);
    const amounts = items.map((item) => item.amount);
    const deadlines = items.map((item) => item.deadline);
    const salts = items.map((item) => item.salt);
    const signatures = items.map((item) => Signature.from(item.signature));

    try {
      const tx = await contract.settleSplit(
        splitIdValue,
        participants,
        amounts,
        deadlines,
        salts,
        signatures.map((s) => s.v),
        signatures.map((s) => s.r),
        signatures.map((s) => s.s),
      );

      const receipt = await tx.wait();
      const now = new Date();

      await this.prisma.$transaction([
        this.prisma.split.update({
          where: { id: split.id },
          data: {
            settled: true,
            updatedAt: now,
          },
        }),
        ...items.map((item) =>
          this.prisma.splitParticipant.update({
            where: {
              splitId_participant: {
                splitId: split.id,
                participant: item.participant,
              },
            },
            data: {
              usedOnchainAt: now,
            },
          }),
        ),
        ...items.map((item) =>
          this.prisma.splitSignature.update({
            where: { id: item.signatureRecordId },
            data: {
              status: SignatureStatus.USED_ONCHAIN,
            },
          }),
        ),
      ]);

      return {
        txHash: receipt.hash,
      };
    } catch (error) {
      throw new BadRequestException(
        `Falha ao liquidar split on-chain: ${(error as Error).message}`,
      );
    }
  }

  async getSplit(splitId: number) {
    const split = await this.findSplitOrThrow(splitId);
    return this.serializeSplit(split);
  }

  async listTokens() {
    const tokens = await this.prisma.supportedToken.findMany({
      orderBy: { enabled: 'desc' },
    });

    return tokens.map((token) => ({
      id: token.id,
      chainId: token.chainId,
      address: getAddress(token.address),
      symbol: token.symbol,
      name: token.name,
      decimals: token.decimals,
      enabled: token.enabled,
      createdAt: token.createdAt,
      updatedAt: token.updatedAt,
    }));
  }

  async checkAllowance(tokenAddress: string, ownerAddress: string) {
    if (!tokenAddress) {
      throw new BadRequestException('token é obrigatório');
    }
    if (!ownerAddress) {
      throw new BadRequestException('owner é obrigatório');
    }
    const token = getAddress(tokenAddress);
    const owner = getAddress(ownerAddress);

    const erc20 = new Contract(token, IERC20Artifact.abi, this.provider);
    const allowance = await erc20.allowance(owner, this.contractAddress);

    return {
      token,
      owner,
      spender: this.contractAddress,
      allowance: allowance.toString(),
    };
  }

  private prepareItemsFromPayload(split: SplitWithRelations, payload: SettleItemDto[]): PreparedSignatureItem[] {
    return payload.map((item) => {
      const participant = getAddress(item.participant);
      const leg = split.participants.find(
        (p) => p.participant.toLowerCase() === participant.toLowerCase(),
      );
      if (!leg) {
        throw new NotFoundException(`Participante ${participant} não encontrado no split`);
      }
      if (leg.amount.toString() !== item.amount) {
        throw new BadRequestException(`Valor divergente para participante ${participant}`);
      }

      const signatureRecord = split.signatures.find(
        (sig) =>
          sig.participant.toLowerCase() === participant.toLowerCase() &&
          this.bufferToHex(sig.salt)?.toLowerCase() === item.salt.toLowerCase(),
      );

      if (!signatureRecord) {
        throw new NotFoundException(`Salt não registrado para ${participant}`);
      }

      if (signatureRecord.status !== SignatureStatus.VALID) {
        throw new BadRequestException(
          `Assinatura para ${participant} não está com status VALID`,
        );
      }

      if (!signatureRecord.signature?.length) {
        throw new BadRequestException(
          `Assinatura armazenada ausente para ${participant}`,
        );
      }

      const recordDeadlineUnix = signatureRecord.deadline
        ? BigInt(Math.floor(signatureRecord.deadline.getTime() / 1000))
        : 0n;
      const payloadDeadline = BigInt(item.deadline);
      if (recordDeadlineUnix !== payloadDeadline) {
        throw new BadRequestException(
          `Deadline fornecido difere do registrado para ${participant}`,
        );
      }

      const storedSignatureHex = this.bufferToHex(signatureRecord.signature);
      if (!storedSignatureHex) {
        throw new BadRequestException(
          `Assinatura registrada inválida para ${participant}`,
        );
      }
      if (storedSignatureHex?.toLowerCase() !== item.signature.toLowerCase()) {
        throw new BadRequestException(`Assinatura fornecida não corresponde ao registro`);
      }

      return {
        participant,
        amount: BigInt(item.amount),
        deadline: BigInt(item.deadline),
        salt: item.salt,
        signature: item.signature,
        signatureRecordId: signatureRecord.id,
      };
    });
  }

  private prepareItemsFromDatabase(split: SplitWithRelations): PreparedSignatureItem[] {
    const validSignatures = split.signatures.filter(
      (sig) => sig.status === SignatureStatus.VALID,
    );

    return validSignatures.map((sig) => {
      if (!sig.signature?.length) {
        throw new BadRequestException(
          `Assinatura não armazenada para participante ${sig.participant}`,
        );
      }

      const participantLeg = split.participants.find(
        (leg) => leg.participant.toLowerCase() === sig.participant.toLowerCase(),
      );
      if (!participantLeg) {
        throw new NotFoundException(
          `Participante ${sig.participant} não encontrado no split`,
        );
      }

      const deadlineUnix = sig.deadline
        ? BigInt(Math.floor(sig.deadline.getTime() / 1000))
        : 0n;

      const saltHex = this.bufferToHex(sig.salt);
      const signatureHex = this.bufferToHex(sig.signature);

      if (!saltHex) {
        throw new BadRequestException(
          `Salt inválido armazenado para participante ${sig.participant}`,
        );
      }

      if (!signatureHex) {
        throw new BadRequestException(
          `Assinatura armazenada inválida para participante ${sig.participant}`,
        );
      }

      return {
        participant: sig.participant,
        amount: BigInt(participantLeg.amount.toString()),
        deadline: deadlineUnix,
        salt: saltHex,
        signature: signatureHex,
        signatureRecordId: sig.id,
      };
    });
  }

  private resolveSplitIdForSigning(split: SplitWithRelations): bigint {
    if (split.splitIdOnchain !== null && split.splitIdOnchain !== undefined) {
      return BigInt(split.splitIdOnchain);
    }
    return BigInt(split.id);
  }

  private buildDomain() {
    return {
      name: this.eip712Name,
      version: this.eip712Version,
      chainId: this.chainId,
      verifyingContract: this.contractAddress,
    };
  }

  private async findSplitOrThrow(splitId: number): Promise<SplitWithRelations> {
    const split = await this.prisma.split.findUnique({
      where: { id: splitId },
      include: {
        participants: true,
        signatures: true,
      },
    });
    if (!split) {
      throw new NotFoundException('Split não encontrado');
    }
    if (split.chainId !== this.chainId) {
      throw new BadRequestException('Split pertence a outra chainId');
    }
    if (split.contract.toLowerCase() !== this.contractAddress.toLowerCase()) {
      throw new BadRequestException('Split utiliza outro contrato coordenador');
    }
    return split;
  }

  private serializeSplit(split: SplitWithRelations) {
    return {
      id: split.id,
      chainId: split.chainId,
      contract: split.contract,
      splitIdOnchain: split.splitIdOnchain?.toString() ?? null,
      payer: split.payer,
      token: split.token,
      totalAmount: split.totalAmount.toString(),
      deadline: split.deadline ? split.deadline.toISOString() : null,
      metaHash: split.metaHash ? this.bufferToHex(split.metaHash) : null,
      settled: split.settled,
      createdAt: split.createdAt,
      updatedAt: split.updatedAt,
      participants: split.participants.map((p) => ({
        id: p.id,
        participant: p.participant,
        amount: p.amount.toString(),
        approvedOffchainAt: p.approvedOffchainAt,
        usedOnchainAt: p.usedOnchainAt,
      })),
      signatures: split.signatures.map((sig) => ({
        id: sig.id,
        participant: sig.participant,
        amount: sig.amount.toString(),
        deadline: sig.deadline ? sig.deadline.toISOString() : null,
        salt: this.bufferToHex(sig.salt),
        signature: sig.signature ? this.bufferToHex(sig.signature) : null,
        status: sig.status,
        reason: sig.reason,
        createdAt: sig.createdAt,
        updatedAt: sig.updatedAt,
      })),
    };
  }

  private bufferToHex(value?: Buffer | Uint8Array | null): string | null {
    if (!value || value.length === 0) {
      return null;
    }
    return hexlify(value);
  }

  private parseIsoDeadline(value: string): Date | null {
    if (value === '0') {
      return null;
    }
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      throw new BadRequestException('deadline inválido');
    }
    return date;
  }

  private resolveApprovalDeadline(
    requestedDeadline: string | undefined,
    splitDeadline: Date | null,
  ) {
    if (requestedDeadline) {
      const parsed = this.parseDeadline(requestedDeadline);
      if (parsed.unix === 0n) {
        return { deadlineDate: null, deadlineUnix: 0n };
      }
      if (splitDeadline) {
        const splitDeadlineUnix = BigInt(Math.floor(splitDeadline.getTime() / 1000));
        if (parsed.unix > splitDeadlineUnix) {
          throw new BadRequestException(
            'Deadline solicitado excede o deadline do split',
          );
        }
      }
      return {
        deadlineDate: parsed.date,
        deadlineUnix: parsed.unix,
      };
    }

    if (!splitDeadline) {
      return { deadlineDate: null, deadlineUnix: 0n };
    }

    const unix = BigInt(Math.floor(splitDeadline.getTime() / 1000));
    return {
      deadlineDate: splitDeadline,
      deadlineUnix: unix,
    };
  }

  private parseDeadline(deadline: string): { date: Date | null; unix: bigint } {
    if (!deadline || deadline === '0') {
      return { date: null, unix: 0n };
    }
    if (/^\d+$/.test(deadline)) {
      const unix = BigInt(deadline);
      if (unix === 0n) {
        return { date: null, unix: 0n };
      }
      const milliseconds = Number(unix) * 1000;
      if (!Number.isFinite(milliseconds)) {
        throw new BadRequestException('deadline fora do intervalo suportado');
      }
      return {
        date: new Date(milliseconds),
        unix,
      };
    }
    const date = new Date(deadline);
    if (Number.isNaN(date.getTime())) {
      throw new BadRequestException('deadline inválido');
    }
    return {
      date,
      unix: BigInt(Math.floor(date.getTime() / 1000)),
    };
  }

  private ensureWriteContract(): Contract {
    if (!this.writeContract || !this.executorWallet) {
      throw new InternalServerErrorException(
        'Executor não configurado (configure EXECUTOR_PRIVATE_KEY)',
      );
    }
    return this.writeContract;
  }
}
