import { Controller, Post, Get, Body, Query, HttpCode, HttpStatus } from '@nestjs/common';
import { AccountService } from './account.service';
import { LinkWalletDto } from './dto/link-wallet.dto';

@Controller('account')
export class AccountController {
  constructor(private readonly accountService: AccountService) {}

  @Post('link-wallet')
  @HttpCode(HttpStatus.OK)
  async linkWallet(@Body() linkWalletDto: LinkWalletDto) {
    return this.accountService.linkWallet(linkWalletDto);
  }

  @Get('transaction-history')
  async getTransactionHistory(@Query('pubkey') pubkey: string) {
    return this.accountService.getTransactionHistory(pubkey);
  }
}
