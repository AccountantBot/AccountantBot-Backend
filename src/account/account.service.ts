import { Injectable, ConflictException, NotFoundException } from '@nestjs/common';
import { LinkWalletDto } from './dto/link-wallet.dto';
import { PrismaService } from 'src/prisma/prisma.service';

@Injectable()
export class AccountService {
  constructor(private readonly prisma: PrismaService) {}

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

  async getPubkeysByTelegramHandles(telegramHandles: string[]): Promise<{ telegramHandle: string; pubkey: string | null }[]> {
    if (!telegramHandles || telegramHandles.length === 0) {
      return [];
    }

    // remove @ if present
    telegramHandles = telegramHandles.map(handle => handle.startsWith('@') ? handle.slice(1) : handle);
    console.log('Handles processados:', telegramHandles);

    // Busca usuários pelos telegram handles
    const users = await this.prisma.user.findMany({
      where: {
        telegramHandle: {
          in: telegramHandles,
        },
      },
      select: {
        telegramHandle: true,
        walletAddress: true,
      },
    });

    console.log('Usuários encontrados:', users);

    // Mapeia os resultados para retornar também os handles que não foram encontrados
    return telegramHandles.map(handle => {
      const user = users.find(u => u.telegramHandle === handle);
      return {
        telegramHandle: handle,
        pubkey: user ? user.walletAddress : null,
      };
    });
  }
}
