import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { BotModule } from './bot/bot.module';
import { AgentModule } from './agents/agent.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    BotModule,
    AgentModule
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
