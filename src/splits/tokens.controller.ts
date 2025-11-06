import { Controller, Get } from '@nestjs/common';
import { SplitsService } from './splits.service';

@Controller('tokens')
export class TokensController {
  constructor(private readonly splitsService: SplitsService) {}

  @Get()
  listTokens() {
    return this.splitsService.listTokens();
  }
}
