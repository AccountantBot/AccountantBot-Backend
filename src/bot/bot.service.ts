import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import TelegramBot from 'node-telegram-bot-api';
import { AgentService } from 'src/agents/agent.service';
import { RedisService } from 'src/redis/redis.service';

@Injectable()
export class BotService implements OnModuleInit {
  private readonly logger = new Logger(BotService.name);
  private bot: TelegramBot;
  private readonly MAX_RETRIES = 3;
  private readonly RETRY_DELAY = 2000; // 2 seconds
  private readonly TRANSACTION_TTL = 300; // 5 minutos em segundos

  constructor(
    @Inject("BOT_TOKEN") private readonly BOT_TOKEN: string,
    @Inject() private readonly agentService: AgentService,
    @Inject() private readonly redisService: RedisService,
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

    // Aprova a transação encontrada para este chat e chama this.sendMoney()
    this.onCommand('sim', async (msg) => {
      const chatId = msg.chat.id;

      try {
        const key = await this.findLatestTransactionKey(chatId);
        if (!key) {
          await this.sendMessage(chatId, 'Nenhuma transação gerada nos últimos 5 minutos, tente pedir para ele gerar transação');
          return;
        }

        const transactionData = await this.redisService.get<any>(key);
        if (!transactionData) {
          await this.sendMessage(chatId, 'Nenhuma transação gerada nos últimos 5 minutos, tente pedir para ele gerar transação');
          return;
        }

        this.logger.log(`Aprovando transação a partir da chave ${key}`);
        // Chama a função responsável por enviar o dinheiro (não implementar aqui)
        await this.sendMessage(chatId, '✅ Transação aprovada. Iniciando processo de envio...');
        await this.sendMoney();

        // Remove a transação do cache após aprovação
        await this.redisService.delete(key);
        await this.sendMessage(chatId, '✅ Transação processada e removida do cache.');
      } catch (error) {
        this.logger.error(`Erro ao processar comando /sim no chat ${chatId}`, error);
        await this.sendMessage(chatId, '❌ Erro ao aprovar transação. Tente novamente.').catch(() => {
          this.logger.error('Falha ao enviar mensagem de erro para o usuário');
        });
      }
    });

    // Recusa a transação e remove do redis
    this.onCommand('não', async (msg) => {
      const chatId = msg.chat.id;

      try {
        const key = await this.findLatestTransactionKey(chatId);
        if (!key) {
          await this.sendMessage(chatId, 'Nenhuma transação gerada nos últimos 5 minutos, tente pedir para ele gerar transação');
          return;
        }

        await this.redisService.delete(key);
        await this.sendMessage(chatId, '❌ Transação recusada e removida do cache.');
      } catch (error) {
        this.logger.error(`Erro ao processar comando /não no chat ${chatId}`, error);
        await this.sendMessage(chatId, '❌ Erro ao recusar transação. Tente novamente.').catch(() => {
          this.logger.error('Falha ao enviar mensagem de erro para o usuário');
        });
      }
    });

    // Edita a transação: anexa o texto passado após o comando e pede para a IA gerar um novo resumo
    this.onCommand('editar', async (msg) => {
      const chatId = msg.chat.id;
      const rawText = msg.text || '';
      const editText = rawText.replace(/^\/editar\b\s*/i, '').trim();

      if (!editText) {
        await this.sendMessage(chatId, 'Por favor informe o que deseja editar após o comando, ex: /editar alterar descrição');
        return;
      }

      try {
        const key = await this.findLatestTransactionKey(chatId);
        if (!key) {
          await this.sendMessage(chatId, 'Nenhuma transação gerada nos últimos 5 minutos, tente pedir para ele gerar transação');
          return;
        }

        const transactionData = await this.redisService.get<any>(key);
        if (!transactionData) {
          await this.sendMessage(chatId, 'Nenhuma transação gerada nos últimos 5 minutos, tente pedir para ele gerar transação');
          return;
        }

        const originalTransaction = transactionData.transaction;

        // Cria uma versão editada da transação anexando o pedido do usuário
        const modifiedTransaction = {
          ...originalTransaction,
          description: `${originalTransaction.description || ''} (edição: ${editText})`,
        };

        const newTransactionData = {
          ...transactionData,
          transaction: modifiedTransaction,
          createdAt: new Date().toISOString(),
        };

        // Salva a transação editada no mesmo key e renova o TTL
        await this.redisService.set(key, newTransactionData, this.TRANSACTION_TTL);

        // Gera e envia novo resumo usando a IA
        const transaction = await this.agentService.analyzeMessage(`
          Houve um erro nos dados da transação anterior. Por favor, considere essa nova versão ao gerar o resumo.
          ${JSON.stringify(modifiedTransaction)} 
        `, []);
        
        if (!transaction) {
          await this.sendMessage(chatId, '❌ Erro ao editar transação com IA. Tente novamente.').catch(() => {
            this.logger.error('Falha ao enviar mensagem de erro para o usuário');
          });
          return;
        }

        const summary = await this.agentService.generateTransactionSummaryWithData(transaction);
        await this.sendMessage(chatId, `✏️ Transação editada:\n${summary}`);
      } catch (error) {
        this.logger.error(`Erro ao processar comando /editar no chat ${chatId}`, error);
        await this.sendMessage(chatId, '❌ Erro ao editar transação. Tente novamente.').catch(() => {
          this.logger.error('Falha ao enviar mensagem de erro para o usuário');
        });
      }
    });
  }

  /**
   * Busca a última chave de transação para um chat específico.
   * Retorna a chave mais recente (com base em createdAt) ou null se não existir.
   */
  private async findLatestTransactionKey(chatId: number | string): Promise<string | null> {
    try {
      const pattern = `transaction:${chatId}:*`;
      const keys = await this.redisService.keys(pattern);

      if (!keys || keys.length === 0) {
        return null;
      }

      // Recupera todos os valores para decidir qual é o mais recente
      let latestKey: string | null = null;
      let latestTime = 0;

      for (const k of keys) {
        try {
          const data = await this.redisService.get<any>(k);
          if (data && data.createdAt) {
            const t = new Date(data.createdAt).getTime();
            if (t > latestTime) {
              latestTime = t;
              latestKey = k;
            }
          } else {
            // Fallback: tenta extrair timestamp do nome da chave
            const parts = k.split(':');
            const candidate = Number(parts[parts.length - 1]);
            if (!isNaN(candidate) && candidate > latestTime) {
              latestTime = candidate;
              latestKey = k;
            }
          }
        } catch (err) {
          this.logger.warn(`Falha ao obter dados para chave Redis '${k}': ${err}`);
        }
      }

      return latestKey;
    } catch (error) {
      this.logger.error('Erro ao buscar chaves de transação no Redis', error);
      return null;
    }
  }

  async sendMoney(): Promise<void> {
    // NÃO IMPLEMENTAR ESSA FUNÇÃO
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
                // Salva os dados da transação no Redis com TTL de 5 minutos
                const requesterId = msg.from?.id || 0;
                const transactionKey = `transaction:${chatId}:${Date.now()}`;
                const transactionData = {
                  type: 'transaction',
                  chatId: chatId,
                  requester: requesterId,
                  transaction: transaction,
                  createdAt: new Date().toISOString(),
                };

                await this.redisService.set(transactionKey, transactionData, this.TRANSACTION_TTL);
                this.logger.log(`Transação salva no Redis com chave: ${transactionKey}`);

                const summary = await this.agentService.generateTransactionSummaryWithData(transaction);
                await this.sendMessage(chatId, summary);

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