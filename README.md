# AccountantBot Backend

Back-end do AccountantBot, responsável por coordenar splits descentralizados na Scroll. A aplicação recebe requisições HTTP, gera intents EIP-712, valida assinaturas e, quando todas as partes aprovam, executa `settleSplit` no contrato `SplitCoordinator` usando `transferFrom` e allowances ERC-20. Também expõe integrações auxiliares (vincular carteiras a usuários de Telegram, bot/IA, Redis cache).

## Visão Geral

- **Framework**: NestJS (Node 20+).
- **Banco**: PostgreSQL via Prisma.
- **Blockchain**: Scroll (EVM). Interação com ethers v6 usando ABIs em `abi/`.
- **Outros**: Redis para cache do bot, OpenAI para parser de mensagens, Telegram Bot API.

Fluxo principal:

1. `POST /splits` cria registro off-chain (opcionalmente chama `createSplit` no contrato).
2. `POST /splits/:id/approve-intent` gera typed-data EIP-712 por participante, salvando salt/status.
3. `POST /splits/:id/signatures` armazena assinatura após verificar `ecrecover`.
4. `POST /splits/:id/settle` envia transação on-chain quando todos assinam.

Documentação completa das rotas: [`docs/api.md`](docs/api.md).

## Requisitos

| Ferramenta | Versão sugerida |
| --- | --- |
| Node.js | >= 20 |
| npm | >= 10 |
| PostgreSQL | 14+ |
| Redis | 6+ (opcional, mas necessário para bot) |

## Configuração do Ambiente

1. Copie `.env.example` (crie se ainda não existir) para `.env` e preencha:

   ```bash
   DATABASE_URL="postgresql://user:pass@localhost:5432/accountant"
   REDIS_HOST=localhost
   REDIS_PORT=6379
   CHAIN_ID=534351            # Scroll Sepolia por padrão
   RPC_URL_SCROLL=https://sepolia-rpc.scroll.io
   SPLIT_COORDINATOR_ADDRESS=0x... # contrato deployado
   EXECUTOR_PRIVATE_KEY=0x... # obrigatório para settle e createOnchain
   EIP712_NAME=Accountant
   EIP712_VERSION=1
   BOT_TOKEN=...              # Telegram bot (opcional)
   OPENAI_API_KEY=...         # IA (opcional)
   ```

2. Instale as dependências:

   ```bash
   npm install
   ```

3. Gere o cliente Prisma e rode as migrações (ajuste conforme seu workflow):

   ```bash
   npx prisma generate
   npx prisma migrate dev
   ```

4. (Opcional) Suba serviços auxiliares com Docker:

   ```bash
   docker compose up -d
   ```

## Execução

```bash
# Desenvolvimento (watch + HMR)
npm run start:dev

# Produção (build + start)
npm run build
npm run start:prod
```

O servidor escuta em `http://localhost:3000` por padrão (configurável via `PORT`).

## Testes

```bash
npm test                # Jest unit tests
npm test -- --runInBand # útil em ambientes limitados
npm run test:e2e        # (se adicionar testes e2e)
```

Os testes atuais cobrem:
- `SplitsService`: criação off-chain, geração de typed-data e validação de assinatura.
- `AppController`: endpoint raiz com mock do bot.

## Principais Pastas

| Caminho | Descrição |
| --- | --- |
| `src/splits` | Módulo responsável pelos fluxos de split: controllers, service e DTOs. |
| `src/prisma` | Provedor global do Prisma (`PrismaService`). |
| `src/account` | Vinculação carteira ↔ Telegram e histórico. |
| `src/bot` | Integração com Telegram (polling, comandos). |
| `src/agents` | Integração com OpenAI para interpretar mensagens. |
| `abi/` | ABIs JSON (`SplitCoordinator`, `IERC20`). |
| `docs/api.md` | Referência detalhada da API. |

## Integração com o Frontend

1. **Criar split**: `POST /splits`.
2. **Gerar intent** para cada participante: `POST /splits/:id/approve-intent`.
3. **Assinar** via carteira (`walletClient.signTypedData`) usando domínio/types/message retornados.
4. **Enviar assinatura**: `POST /splits/:id/signatures`.
5. **Verificar status**: `GET /splits/:id`; exibir `approvedOffchainAt`, `status`.
6. **Settle**: `POST /splits/:id/settle` (automático ou via payload custom). Requer allowances concedidos pelos participantes.
7. **Consultar tokens/allowances**: `GET /tokens`, `GET /splits/allowances/check`.

Checklist com exemplos de cURL e FAQs: veja [`docs/api.md`](docs/api.md).

## Lint & Formatação

```bash
npm run lint
npm run format
```

## Scripts Úteis

| Script | Descrição |
| --- | --- |
| `npm run start` | Inicia em modo padrão (não watch). |
| `npm run build` | Compila para `dist/`. |
| `npm run start:dev` | Desenvolvimento com watch. |
| `npm run test` | Testes unitários. |
| `npm run test:e2e` | (placeholder) testes e2e. |

## Referências Externas

- [NestJS Documentation](https://docs.nestjs.com/)
- [Prisma Docs](https://www.prisma.io/docs/)
- [Scroll Network](https://scroll.io/)
- [EIP-712](https://eips.ethereum.org/EIPS/eip-712)
- [ethers v6](https://docs.ethers.org/v6/)

## Licença

Este projeto segue a licença especificada no repositório original (verifique `package.json` / `LICENSE`, se aplicável).
