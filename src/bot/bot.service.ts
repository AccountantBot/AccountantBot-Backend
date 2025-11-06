import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import TelegramBot from 'node-telegram-bot-api';

@Injectable()
export class BotService implements OnModuleInit {
  private readonly logger = new Logger(BotService.name);
  private bot: TelegramBot;

  constructor(
    @Inject("BOT_TOKEN") private readonly BOT_TOKEN: string,
  ) {}

  async onModuleInit() {
    const token = this.BOT_TOKEN;
    if (!token) {
      this.logger.error('BOT_TOKEN não encontrado nas variáveis de ambiente');
      throw new Error('BOT_TOKEN é obrigatório');
    }

    // Inicializa o bot SEM polling para evitar conflitos com getUpdates
    this.bot = new TelegramBot(token, { polling: false });
    
    try {
      // Testa a conexão obtendo informações do bot
      const botInfo = await this.bot.getMe();
      this.logger.log(`Bot conectado com sucesso: @${botInfo.username} (ID: ${botInfo.id})`);
      
      // Agora ativa o polling
      await this.bot.startPolling();
      this.logger.log('Polling iniciado com sucesso');

      this.logger.log('Configurando listeners de mensagens');
      this.listenAndValidateMessages();
    } catch (error) {
      this.logger.error('Erro ao inicializar bot', error);
      throw error;
    }
  }

  async listenAndValidateMessages(): Promise<void> {
    this.onMessage((msg) => {
      const chatId = msg.chat.id;
      const text = msg.text || '';
      
      // Busca os dados do chat, usuários e carteiras a partir do chatId

      this.logger.log(`Mensagem recebida do chat ${chatId}: ${text}`);

      

    })
  }

  /**
   * Verifica se o bot está conectado e retorna informações sobre ele
   */
  async getBotInfo(): Promise<TelegramBot.User> {
    try {
      const botInfo = await this.bot.getMe();
      this.logger.log(`Bot info: @${botInfo.username} (ID: ${botInfo.id})`);
      return botInfo;
    } catch (error) {
      this.logger.error('Erro ao obter informações do bot', error);
      throw error;
    }
  }

  /**
   * Testa a conectividade do bot enviando uma mensagem de teste
   * @param chatId - ID do chat para teste (pode ser seu próprio ID)
   */
  async testConnection(chatId: number | string): Promise<boolean> {
    try {
      await this.sendMessage(chatId, '✅ Bot conectado e funcionando!');
      this.logger.log('Teste de conexão bem-sucedido');
      return true;
    } catch (error) {
      this.logger.error('Teste de conexão falhou', error);
      return false;
    }
  }

  /**
   * Retorna a instância do bot para uso direto quando necessário
   */
  getBotInstance(): TelegramBot {
    return this.bot;
  }

  /**
   * IMPORTANTE: getUpdates não funciona quando polling está ativo!
   * Use listeners de eventos ou desative o polling.
   * Este método só funciona se o bot for inicializado sem polling.
   */
  async getUpdates(
    offset?: number,
    limit?: number,
    timeout?: number,
  ): Promise<TelegramBot.Update[]> {
    this.logger.warn('getUpdates não funciona com polling ativo. Use listeners de eventos em vez disso.');
    
    try {
      // Temporariamente para o polling
      await this.bot.stopPolling();
      
      const updates = await this.bot.getUpdates({
        offset,
        limit,
        timeout,
      });
      
      // Reinicia o polling
      await this.bot.startPolling();
      
      this.logger.debug(`${updates.length} atualizações obtidas`);
      return updates;
    } catch (error) {
      this.logger.error('Erro ao obter atualizações', error);
      // Garante que o polling seja reiniciado mesmo em caso de erro
      try {
        await this.bot.startPolling();
      } catch (restartError) {
        this.logger.error('Erro ao reiniciar polling', restartError);
      }
      throw error;
    }
  }

  /**
   * Registra um listener para mensagens recebidas
   * @param callback - Função a ser executada quando uma mensagem for recebida
   */
  onMessage(callback: (msg: TelegramBot.Message) => void): void {
    this.logger.log('Listener de mensagens registrado');
    this.bot.on('message', callback);
  }

  /**
   * Registra um listener para comandos específicos
   * @param command - Comando a ser ouvido (sem a barra inicial)
   * @param callback - Função a ser executada quando o comando for recebido
   */
  onCommand(command: string, callback: (msg: TelegramBot.Message) => void): void {
    this.bot.onText(new RegExp(`^/${command}`), callback);
  }

  /**
   * Envia uma mensagem de texto para um chat específico
   */
  async sendMessage(
    chatId: number | string,
    text: string,
    options?: TelegramBot.SendMessageOptions,
  ): Promise<TelegramBot.Message> {
    try {
      const message = await this.bot.sendMessage(chatId, text, options);
      this.logger.debug(`Mensagem enviada para o chat ${chatId}`);
      return message;
    } catch (error) {
      this.logger.error(`Erro ao enviar mensagem para o chat ${chatId}`, error);
      throw error;
    }
  }

  /**
   * Envia uma mensagem com formatação Markdown
   */
  async sendMarkdownMessage(
    chatId: number | string,
    text: string,
    options?: TelegramBot.SendMessageOptions,
  ): Promise<TelegramBot.Message> {
    return this.sendMessage(chatId, text, {
      ...options,
      parse_mode: 'Markdown',
    });
  }

  /**
   * Envia uma mensagem com formatação HTML
   */
  async sendHtmlMessage(
    chatId: number | string,
    text: string,
    options?: TelegramBot.SendMessageOptions,
  ): Promise<TelegramBot.Message> {
    return this.sendMessage(chatId, text, {
      ...options,
      parse_mode: 'HTML',
    });
  }

  /**
   * Responde a uma mensagem específica
   */
  async replyToMessage(
    chatId: number | string,
    messageId: number,
    text: string,
    options?: TelegramBot.SendMessageOptions,
  ): Promise<TelegramBot.Message> {
    return this.sendMessage(chatId, text, {
      ...options,
      reply_to_message_id: messageId,
    });
  }
}