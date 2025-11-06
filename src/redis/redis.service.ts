import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { createClient, RedisClientType } from 'redis';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private client: RedisClientType;
  private readonly MAX_RETRIES = 3;
  private readonly RETRY_DELAY = 2000; // 2 seconds

  async onModuleInit() {
    await this.connect();
  }

  async onModuleDestroy() {
    await this.disconnect();
  }

  /**
   * Conecta ao Redis com retry logic
   */
  private async connect(attempt: number = 1): Promise<void> {
    try {
      const redisHost = process.env.REDIS_HOST || 'localhost';
      const redisPort = parseInt(process.env.REDIS_PORT || '6379', 10);

      this.client = createClient({
        socket: {
          host: redisHost,
          port: redisPort,
          reconnectStrategy: (retries) => {
            if (retries > 10) {
              this.logger.error('Número máximo de tentativas de reconexão excedido');
              return new Error('Número máximo de tentativas excedido');
            }
            return retries * 1000; // Espera incremental
          },
        },
      });

      this.client.on('error', (err) => {
        this.logger.error('Erro no cliente Redis', err);
      });

      this.client.on('connect', () => {
        this.logger.log('Conectando ao Redis...');
      });

      this.client.on('ready', () => {
        this.logger.log('Redis conectado e pronto para uso');
      });

      this.client.on('reconnecting', () => {
        this.logger.warn('Reconectando ao Redis...');
      });

      await this.client.connect();
      this.logger.log(`Conectado ao Redis em ${redisHost}:${redisPort}`);
    } catch (error) {
      this.logger.error(`Erro ao conectar ao Redis (tentativa ${attempt}/${this.MAX_RETRIES})`, error);

      if (attempt < this.MAX_RETRIES) {
        this.logger.log(`Aguardando ${this.RETRY_DELAY}ms antes de tentar novamente...`);
        await this.sleep(this.RETRY_DELAY);
        return this.connect(attempt + 1);
      } else {
        this.logger.error('Não foi possível conectar ao Redis após múltiplas tentativas');
        throw error;
      }
    }
  }

  /**
   * Desconecta do Redis
   */
  private async disconnect(): Promise<void> {
    try {
      if (this.client && this.client.isOpen) {
        await this.client.quit();
        this.logger.log('Desconectado do Redis');
      }
    } catch (error) {
      this.logger.error('Erro ao desconectar do Redis', error);
    }
  }

  /**
   * Define um valor no Redis com TTL opcional
   * @param key - Chave
   * @param value - Valor (será convertido para JSON)
   * @param ttlSeconds - TTL em segundos (opcional)
   */
  async set(key: string, value: any, ttlSeconds?: number): Promise<void> {
    try {
      const serializedValue = JSON.stringify(value);
      
      if (ttlSeconds) {
        await this.client.setEx(key, ttlSeconds, serializedValue);
        this.logger.debug(`Chave '${key}' definida com TTL de ${ttlSeconds}s`);
      } else {
        await this.client.set(key, serializedValue);
        this.logger.debug(`Chave '${key}' definida sem TTL`);
      }
    } catch (error) {
      this.logger.error(`Erro ao definir chave '${key}' no Redis`, error);
      throw error;
    }
  }

  /**
   * Obtém um valor do Redis
   * @param key - Chave
   * @returns Valor deserializado ou null se não existir
   */
  async get<T = any>(key: string): Promise<T | null> {
    try {
      const value = await this.client.get(key);
      
      if (value === null) {
        this.logger.debug(`Chave '${key}' não encontrada`);
        return null;
      }

      const deserializedValue = JSON.parse(value) as T;
      this.logger.debug(`Chave '${key}' recuperada com sucesso`);
      return deserializedValue;
    } catch (error) {
      this.logger.error(`Erro ao obter chave '${key}' do Redis`, error);
      throw error;
    }
  }

  /**
   * Deleta uma chave do Redis
   * @param key - Chave
   * @returns true se a chave foi deletada, false se não existia
   */
  async delete(key: string): Promise<boolean> {
    try {
      const result = await this.client.del(key);
      const deleted = result > 0;
      
      if (deleted) {
        this.logger.debug(`Chave '${key}' deletada com sucesso`);
      } else {
        this.logger.debug(`Chave '${key}' não existia`);
      }
      
      return deleted;
    } catch (error) {
      this.logger.error(`Erro ao deletar chave '${key}' do Redis`, error);
      throw error;
    }
  }

  /**
   * Verifica se uma chave existe
   * @param key - Chave
   * @returns true se a chave existe, false caso contrário
   */
  async exists(key: string): Promise<boolean> {
    try {
      const result = await this.client.exists(key);
      return result === 1;
    } catch (error) {
      this.logger.error(`Erro ao verificar existência da chave '${key}'`, error);
      throw error;
    }
  }

  /**
   * Define o TTL de uma chave existente
   * @param key - Chave
   * @param ttlSeconds - TTL em segundos
   * @returns true se o TTL foi definido, false se a chave não existe
   */
  async expire(key: string, ttlSeconds: number): Promise<boolean> {
    try {
      const result = await this.client.expire(key, ttlSeconds);
      
      if (result) {
        this.logger.debug(`TTL de ${ttlSeconds}s definido para chave '${key}'`);
      } else {
        this.logger.debug(`Chave '${key}' não existe, não foi possível definir TTL`);
      }
      
      return Boolean(result);
    } catch (error) {
      this.logger.error(`Erro ao definir TTL para chave '${key}'`, error);
      throw error;
    }
  }

  /**
   * Obtém o TTL restante de uma chave
   * @param key - Chave
   * @returns TTL em segundos, -1 se não tem TTL, -2 se a chave não existe
   */
  async ttl(key: string): Promise<number> {
    try {
      const ttl = await this.client.ttl(key);
      return ttl;
    } catch (error) {
      this.logger.error(`Erro ao obter TTL da chave '${key}'`, error);
      throw error;
    }
  }

  /**
   * Busca chaves que correspondem a um padrão
   * @param pattern - Padrão de busca (ex: 'transaction:*')
   * @returns Array de chaves encontradas
   */
  async keys(pattern: string): Promise<string[]> {
    try {
      const keys = await this.client.keys(pattern);
      this.logger.debug(`${keys.length} chaves encontradas para o padrão '${pattern}'`);
      return keys;
    } catch (error) {
      this.logger.error(`Erro ao buscar chaves com padrão '${pattern}'`, error);
      throw error;
    }
  }

  /**
   * Limpa todas as chaves do banco de dados atual
   * CUIDADO: Use apenas em desenvolvimento/testes
   */
  async flushDb(): Promise<void> {
    try {
      await this.client.flushDb();
      this.logger.warn('Banco de dados Redis limpo (FLUSHDB)');
    } catch (error) {
      this.logger.error('Erro ao limpar banco de dados Redis', error);
      throw error;
    }
  }

  /**
   * Retorna a instância do cliente Redis para operações avançadas
   */
  getClient(): RedisClientType {
    return this.client;
  }

  /**
   * Utility function para aguardar um período de tempo
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
