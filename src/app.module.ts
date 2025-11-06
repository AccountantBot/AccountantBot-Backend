import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { BotModule } from './bot/bot.module';
import { AgentModule } from './agents/agent.module';
import { AccountModule } from './account/account.module';
import { SplitsModule } from './splits/splits.module';
import { PrismaModule } from './prisma/prisma.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    PrismaModule,
    BotModule,
    AgentModule,
    AccountModule,
    SplitsModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
