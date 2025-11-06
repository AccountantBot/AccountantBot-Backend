import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import TelegramBot from 'node-telegram-bot-api';
import { AgentService } from 'src/agents/agent.service';

@Injectable()
export class BotService implements OnModuleInit {
  private readonly logger = new Logger(BotService.name);
  private bot: TelegramBot;
  private readonly MAX_RETRIES = 3;
  private readonly RETRY_DELAY = 2000; // 2 seconds

  constructor(
    @Inject("BOT_TOKEN") private readonly BOT_TOKEN: string,
    @Inject() private readonly agentService: AgentService,
  ) {}

  async onModuleInit() {
    const token = this.BOT_TOKEN;
    if (!token) {
      this.logger.error('BOT_TOKEN não encontrado nas variáveis de ambiente');
      throw new Error('BOT_TOKEN é obrigatório');
    }

    await this.initializeBotWithRetry();
  }

  /**
   * Inicializa o bot com retry logic
   */
  private async initializeBotWithRetry(attempt: number = 1): Promise<void> {
    try {
      // Inicializa o bot SEM polling para evitar conflitos com getUpdates
      this.bot = new TelegramBot(this.BOT_TOKEN, { polling: false });
      
      // Testa a conexão obtendo informações do bot
      const botInfo = await this.bot.getMe();
      this.logger.log(`Bot conectado com sucesso: @${botInfo.username} (ID: ${botInfo.id})`);
      
      // Agora ativa o polling
      await this.bot.startPolling();
      this.logger.log('Polling iniciado com sucesso');

      this.logger.log('Configurando listeners de mensagens');
      this.setupErrorHandlers();
      this.listenCommands();
      this.listenAndValidateMessages();
    } catch (error) {
      this.logger.error(`Erro ao inicializar bot (tentativa ${attempt}/${this.MAX_RETRIES})`, error);
      
      if (attempt < this.MAX_RETRIES) {
        this.logger.log(`Aguardando ${this.RETRY_DELAY}ms antes de tentar novamente...`);
        await this.sleep(this.RETRY_DELAY);
        return this.initializeBotWithRetry(attempt + 1);
      } else {
        this.logger.error('Número máximo de tentativas excedido. Bot não pôde ser inicializado.');
        throw error;
      }
    }
  }

  /**
   * Configura handlers de erro globais do bot
   */
  private setupErrorHandlers(): void {
    this.bot.on('polling_error', (error) => {
      this.logger.error('Erro de polling detectado', error);
      this.handlePollingError(error);
    });

    this.bot.on('error', (error) => {
      this.logger.error('Erro geral do bot detectado', error);
    });
  }

  /**
   * Trata erros de polling e tenta reconectar
   */
  private async handlePollingError(error: Error): Promise<void> {
    try {
      this.logger.warn('Tentando reiniciar polling...');
      await this.bot.stopPolling();
      await this.sleep(this.RETRY_DELAY);
      await this.bot.startPolling();
      this.logger.log('Polling reiniciado com sucesso');
    } catch (restartError) {
      this.logger.error('Erro ao reiniciar polling', restartError);
      // Tenta reinicializar completamente o bot
      await this.sleep(this.RETRY_DELAY * 2);
      await this.initializeBotWithRetry();
    }
  }

  async listenCommands(): Promise<void> {
    this.onCommand('receba', async (msg) => {
      const chatId = msg.chat.id;
      const username = msg.from?.username;
      
      try {
        await this.sendMessage(chatId, `O usuário ${username} entrou na lista de pagamento`);
        // ! IMPLEMENTAR LÓGICA DE ADIÇÃO DO USUÁRIO NA LISTA DE PAGAMENTO
      } catch (error) {
        this.logger.error(`Erro ao processar comando /receba no chat ${chatId}`, error);
      }
    });
  }

  async listenAndValidateMessages(): Promise<void> {
    this.onMessage(async (msg) => {
      const chatId = msg.chat.id;
      const text = msg.text || '';

      this.logger.log(`Mensagem recebida do chat ${chatId}: ${text}`);

      try {
        // Captura a lista dos arrobas dos membros do grupo, se aplicável
        let groupMembers: string[] | undefined;
        if (msg.chat.type === 'group' || msg.chat.type === 'supergroup') {
          // ! IMPLEMENTAR LÓGICA PARA OBTER MEMBROS NA LISTA DE PAGAMENTO
          groupMembers = []; // Placeholder

          try {
            const transaction = await this.agentService.analyzeMessage(text, groupMembers);
            
            if (transaction) {
              this.logger.log(`Transação detectada: ${JSON.stringify(transaction)}`);
              
              try {

                const summary = await this.agentService.generateTransactionSummaryWithData(transaction);
                await this.sendMessage(chatId, summary);
                // ! IMPLEMENTAR LÓGICA DE PROCESSAMENTO DA TRANSAÇÃO

              } catch (summaryError) {

                this.logger.error('Erro ao gerar/enviar resumo da transação', summaryError);
                await this.sendMessage(chatId, '❌ Erro ao processar transação. Tente novamente.').catch(() => {
                  this.logger.error('Falha ao enviar mensagem de erro para o usuário');
                });
                
              }
            } else {
              this.logger.log('Nenhuma transação detectada na mensagem');
            }
          } catch (analysisError) {
            this.logger.error('Erro ao analisar mensagem com IA', analysisError);
            await this.sendMessage(chatId, '❌ Erro ao analisar mensagem. Tente novamente.').catch(() => {
              this.logger.error('Falha ao enviar mensagem de erro para o usuário');
            });
          }
        }
      } catch (error) {
        this.logger.error(`Erro ao processar mensagem do chat ${chatId}`, error);
      }
    });
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
   * Envia uma mensagem de texto para um chat específico com retry logic
   */
  async sendMessage(
    chatId: number | string,
    text: string,
    options?: TelegramBot.SendMessageOptions,
  ): Promise<TelegramBot.Message> {
    return this.sendMessageWithRetry(chatId, text, options);
  }

  /**
   * Envia mensagem com retry logic
   */
  private async sendMessageWithRetry(
    chatId: number | string,
    text: string,
    options?: TelegramBot.SendMessageOptions,
    attempt: number = 1,
  ): Promise<TelegramBot.Message> {
    try {
      const message = await this.bot.sendMessage(chatId, text, options);
      this.logger.debug(`Mensagem enviada para o chat ${chatId}`);
      return message;
    } catch (error) {
      this.logger.error(
        `Erro ao enviar mensagem para o chat ${chatId} (tentativa ${attempt}/${this.MAX_RETRIES})`,
        error,
      );

      if (attempt < this.MAX_RETRIES) {
        this.logger.log(`Aguardando ${this.RETRY_DELAY}ms antes de tentar novamente...`);
        await this.sleep(this.RETRY_DELAY);
        return this.sendMessageWithRetry(chatId, text, options, attempt + 1);
      } else {
        this.logger.error(`Falha ao enviar mensagem após ${this.MAX_RETRIES} tentativas`);
        throw error;
      }
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
    try {
      return await this.sendMessage(chatId, text, {
        ...options,
        parse_mode: 'Markdown',
      });
    } catch (error) {
      this.logger.error(`Erro ao enviar mensagem Markdown para o chat ${chatId}`, error);
      throw error;
    }
  }

  /**
   * Envia uma mensagem com formatação HTML
   */
  async sendHtmlMessage(
    chatId: number | string,
    text: string,
    options?: TelegramBot.SendMessageOptions,
  ): Promise<TelegramBot.Message> {
    try {
      return await this.sendMessage(chatId, text, {
        ...options,
        parse_mode: 'HTML',
      });
    } catch (error) {
      this.logger.error(`Erro ao enviar mensagem HTML para o chat ${chatId}`, error);
      throw error;
    }
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
    try {
      return await this.sendMessage(chatId, text, {
        ...options,
        reply_to_message_id: messageId,
      });
    } catch (error) {
      this.logger.error(`Erro ao responder mensagem ${messageId} no chat ${chatId}`, error);
      throw error;
    }
  }

  /**
   * Utility function para aguardar um período de tempo
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}