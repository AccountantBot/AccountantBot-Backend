import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { BotService } from './bot.service';
import { BotController } from './bot.controller';

@Module({
  imports: [ConfigModule,],
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
