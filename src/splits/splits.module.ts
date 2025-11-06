import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { SplitsService } from './splits.service';
import { SplitsController } from './splits.controller';
import { TokensController } from './tokens.controller';

@Module({
  imports: [ConfigModule],
  controllers: [SplitsController, TokensController],
  providers: [SplitsService],
  exports: [SplitsService],
})
export class SplitsModule {}
