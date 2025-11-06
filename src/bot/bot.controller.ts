import { Controller, Get, Post, Body, Param } from '@nestjs/common';
import { BotService } from './bot.service';

@Controller('bot')
export class BotController {
  constructor(private readonly botService: BotService) {}

  /**
   * Endpoint para verificar informações do bot
   * GET /bot/info
   */
  @Get('info')
  async getBotInfo() {
    return await this.botService.getBotInfo();
  }

  /**
   * Endpoint para testar conexão enviando mensagem
   * POST /bot/test
   * Body: { "chatId": "seu_chat_id" }
   */
  @Post('test')
  async testConnection(@Body('chatId') chatId: string | number) {
    const result = await this.botService.testConnection(chatId);
    return {
      success: result,
      message: result ? 'Bot conectado!' : 'Falha na conexão',
    };
  }

  /**
   * Endpoint para enviar mensagem
   * POST /bot/send/:chatId
   * Body: { "message": "texto da mensagem" }
   */
  @Post('send/:chatId')
  async sendMessage(
    @Param('chatId') chatId: string,
    @Body('message') message: string,
  ) {
    const result = await this.botService.sendMessage(chatId, message);
    return {
      success: true,
      messageId: result.message_id,
    };
  }
}