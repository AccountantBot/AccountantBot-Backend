import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { BotService } from './bot.service';
import { BotController } from './bot.controller';
import { AgentModule } from 'src/agents/agent.module';
import { RedisModule } from 'src/redis/redis.module';
import { AccountModule } from 'src/account/account.module';

@Module({
  imports: [ConfigModule, AgentModule, RedisModule, AccountModule],
  providers: [
    BotService,
    {
      provide: "BOT_TOKEN",
      useFactory: () => process.env.BOT_TOKEN,
    }
  ],
  controllers: [BotController],
  exports: [BotService],
})
export class BotModule {}
