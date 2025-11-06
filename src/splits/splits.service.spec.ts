import { ConfigService } from '@nestjs/config';
import { Prisma, SignatureStatus } from '@prisma/client';
import { SplitsService } from './splits.service';
import { PrismaService } from 'src/prisma/prisma.service';
import { Wallet } from 'ethers';

describe('SplitsService', () => {
  let service: SplitsService;
  let configService: ConfigService;
  let prismaMock: {
    split: {
      create: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
    };
    splitSignature: {
      create: jest.Mock;
      update: jest.Mock;
    };
    splitParticipant: {
      update: jest.Mock;
    };
    supportedToken: {
      findMany: jest.Mock;
    };
    $transaction: jest.Mock;
  };

  beforeEach(() => {
    prismaMock = {
      split: {
        create: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      splitSignature: {
        create: jest.fn(),
        update: jest.fn(),
      },
      splitParticipant: {
        update: jest.fn(),
      },
      supportedToken: {
        findMany: jest.fn(),
      },
      $transaction: jest.fn().mockImplementation(async (actions: Promise<unknown>[]) => {
        return Promise.all(actions);
      }),
    };

    configService = {
      get: jest.fn((key: string) => {
        switch (key) {
          case 'CHAIN_ID':
            return '534351';
          case 'SPLIT_COORDINATOR_ADDRESS':
            return '0x0000000000000000000000000000000000000001';
          case 'RPC_URL_SCROLL':
            return 'http://localhost:8545';
          case 'EIP712_NAME':
            return 'Accountant';
          case 'EIP712_VERSION':
            return '1';
          case 'EXECUTOR_PRIVATE_KEY':
            return undefined;
          default:
            return undefined;
        }
      }),
    } as unknown as ConfigService;

    service = new SplitsService(prismaMock as unknown as PrismaService, configService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('cria um split off-chain sem tocar o contrato', async () => {
    const now = new Date();
    prismaMock.split.create.mockResolvedValue({
      id: 1,
      chainId: 534351,
      contract: '0x0000000000000000000000000000000000000001',
      splitIdOnchain: null,
      payer: '0x00000000000000000000000000000000000000a0',
      token: '0x00000000000000000000000000000000000000b0',
      totalAmount: new Prisma.Decimal('25000000'),
      deadline: now,
      metaHash: null,
      settled: false,
      createdAt: now,
      updatedAt: now,
      participants: [],
      signatures: [],
    });

    const response = await service.createSplit({
      payer: '0x00000000000000000000000000000000000000a0',
      token: '0x00000000000000000000000000000000000000b0',
      legs: [
        { participant: '0x00000000000000000000000000000000000000c0', amount: '12500000' },
        { participant: '0x00000000000000000000000000000000000000d0', amount: '12500000' },
      ],
      deadline: now.toISOString(),
      metaHash: '0x' + '11'.repeat(32),
      createOnchain: false,
    });

    expect(prismaMock.split.create).toHaveBeenCalledTimes(1);
    const createArgs = prismaMock.split.create.mock.calls[0][0];
    expect(createArgs.data.totalAmount).toBeInstanceOf(Prisma.Decimal);
    expect(createArgs.data.participants.create).toHaveLength(2);
    expect(response).toEqual({ id: 1, txHash: null });
  });

  it('gera typed-data e aceita assinatura válida', async () => {
    const wallet = Wallet.createRandom();
    const splitId = 42;
    const now = new Date();

    const splitForIntent = {
      id: splitId,
      chainId: 534351,
      contract: '0x0000000000000000000000000000000000000001',
      splitIdOnchain: null,
      payer: '0x00000000000000000000000000000000000000aa',
      token: '0x00000000000000000000000000000000000000bb',
      totalAmount: new Prisma.Decimal('12500000'),
      deadline: now,
      metaHash: null,
      settled: false,
      createdAt: now,
      updatedAt: now,
      participants: [
        {
          id: 1,
          splitId,
          participant: wallet.address,
          amount: new Prisma.Decimal('12500000'),
          approvedOffchainAt: null,
          usedOnchainAt: null,
        },
      ],
      signatures: [] as any[],
    };

    prismaMock.split.findUnique.mockResolvedValueOnce(splitForIntent);
    prismaMock.splitSignature.create.mockResolvedValue({ id: 100 });

    const typedData = await service.generateApproveIntent(splitId, {
      participant: wallet.address,
      deadline: now.toISOString(),
    });

    expect(prismaMock.splitSignature.create).toHaveBeenCalledTimes(1);
    const signatureRecordArgs = prismaMock.splitSignature.create.mock.calls[0][0];
    const generatedSalt: Buffer = signatureRecordArgs.data.salt;
    const generatedDeadline: Date | null = signatureRecordArgs.data.deadline;

    expect(typedData.domain.verifyingContract).toBe('0x0000000000000000000000000000000000000001');
    expect(typedData.message.participant).toBe(wallet.address);
    expect(typedData.message.salt.toLowerCase()).toBe(
      '0x' + generatedSalt.toString('hex'),
    );

    const splitWithSignature = {
      ...splitForIntent,
      signatures: [
        {
          id: 200,
          splitId,
          participant: wallet.address,
          amount: new Prisma.Decimal('12500000'),
          deadline: generatedDeadline,
          salt: generatedSalt,
          signature: Buffer.alloc(0),
          status: SignatureStatus.PENDING,
          reason: null,
          createdAt: now,
          updatedAt: now,
        },
      ],
    };

    prismaMock.split.findUnique.mockResolvedValueOnce(splitWithSignature);
    prismaMock.splitSignature.update.mockResolvedValue({});
    prismaMock.splitParticipant.update.mockResolvedValue({});

    const signature = await wallet.signTypedData(
      typedData.domain,
      typedData.types as Record<string, Array<{ name: string; type: string }>>,
      typedData.message,
    );

    const result = await service.submitSignature(splitId, {
      participant: wallet.address,
      amount: typedData.message.amount,
      deadline: typedData.message.deadline,
      salt: typedData.message.salt,
      signature,
    });

    expect(result).toEqual({ ok: true });
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
    const updateArgs = prismaMock.splitSignature.update.mock.calls[0][0];
    expect(updateArgs.data.status).toBe(SignatureStatus.VALID);
    expect(Buffer.isBuffer(updateArgs.data.signature)).toBe(true);
  });
});
