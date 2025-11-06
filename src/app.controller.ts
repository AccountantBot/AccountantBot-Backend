import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service';
import { BotService } from './bot/bot.service';

@Controller()
export class AppController {
  constructor(
    private readonly appService: AppService,
    private readonly botService: BotService,
  ) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  /**
   * Exemplo de endpoint que demonstra o uso do BotService
   * Para usar o bot em qualquer parte da aplicação, basta injetar o BotService
   */
  @Get('bot/test')
  async testBot() {
    // Exemplo de uso: enviar uma mensagem
    // const message = await this.botService.sendMessage(chatId, 'Olá!');
    
    // Exemplo de uso: obter atualizações
    const updates = await this.botService.getUpdates();
    
    return {
      updates
    };
  }
}
