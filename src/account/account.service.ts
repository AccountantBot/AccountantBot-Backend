import { Injectable, ConflictException, NotFoundException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { LinkWalletDto } from './dto/link-wallet.dto';

@Injectable()
export class AccountService {
  private prisma: PrismaClient;

  constructor() {
    this.prisma = new PrismaClient();
  }

  async onModuleInit() {
    await this.prisma.$connect();
  }

  async onModuleDestroy() {
    await this.prisma.$disconnect();
  }

  async linkWallet(linkWalletDto: LinkWalletDto) {
    const { telegram, pubkey } = linkWalletDto;

    // Verificar se já existe um usuário com essa wallet
    const existingUser = await this.prisma.user.findUnique({
      where: { walletAddress: pubkey },
    });

    if (existingUser) {
      // Se já existe, apenas atualiza o telegram handle
      if (existingUser.telegramHandle === telegram) {
        return {
          message: 'Wallet já vinculada a este Telegram',
          user: existingUser,
        };
      }

      // Verifica se o telegram já está sendo usado por outra wallet
      const telegramInUse = await this.prisma.user.findUnique({
        where: { telegramHandle: telegram },
      });

      if (telegramInUse && telegramInUse.id !== existingUser.id) {
        throw new ConflictException('Este Telegram já está vinculado a outra wallet');
      }

      const updatedUser = await this.prisma.user.update({
        where: { id: existingUser.id },
        data: { telegramHandle: telegram },
      });

      return {
        message: 'Telegram atualizado com sucesso',
        user: updatedUser,
      };
    }

    // Verifica se o telegram já está sendo usado
    const telegramExists = await this.prisma.user.findUnique({
      where: { telegramHandle: telegram },
    });

    if (telegramExists) {
      throw new ConflictException('Este Telegram já está vinculado a outra wallet');
    }

    // Cria novo usuário
    const newUser = await this.prisma.user.create({
      data: {
        walletAddress: pubkey,
        telegramHandle: telegram,
      },
    });

    return {
      message: 'Wallet vinculada com sucesso',
      user: newUser,
    };
  }

  async getTransactionHistory(pubkey: string) {
    if (!pubkey || pubkey.trim() === '') {
      throw new NotFoundException('Chave pública não fornecida');
    }

    // Busca splits onde o usuário é o payer
    const splitsAsPayer = await this.prisma.split.findMany({
      where: {
        payer: pubkey,
      },
      include: {
        participants: true,
        signatures: true,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    // Busca splits onde o usuário é participante
    const splitsAsParticipant = await this.prisma.splitParticipant.findMany({
      where: {
        participant: pubkey,
      },
      include: {
        split: {
          include: {
            participants: true,
            signatures: true,
          },
        },
      },
      orderBy: {
        split: {
          createdAt: 'desc',
        },
      },
    });

    return {
      asPayer: splitsAsPayer,
      asParticipant: splitsAsParticipant.map(sp => sp.split),
      total: splitsAsPayer.length + splitsAsParticipant.length,
    };
  }
}
