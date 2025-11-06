import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
} from '@nestjs/common';
import { CreateSplitDto } from './dto/create-split.dto';
import { SplitsService } from './splits.service';
import { ApproveIntentDto } from './dto/approve-intent.dto';
import { SubmitSignatureDto } from './dto/submit-signature.dto';
import { SettleSplitDto } from './dto/settle-split.dto';

@Controller('splits')
export class SplitsController {
  constructor(private readonly splitsService: SplitsService) {}

  @Post()
  createSplit(@Body() dto: CreateSplitDto) {
    return this.splitsService.createSplit(dto);
  }

  @Get('allowances/check')
  checkAllowance(
    @Query('token') token: string,
    @Query('owner') owner: string,
  ) {
    return this.splitsService.checkAllowance(token, owner);
  }

  @Get(':id')
  getSplit(@Param('id', ParseIntPipe) id: number) {
    return this.splitsService.getSplit(id);
  }

  @Post(':id/approve-intent')
  generateApproveIntent(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ApproveIntentDto,
  ) {
    return this.splitsService.generateApproveIntent(id, dto);
  }

  @Post(':id/signatures')
  submitSignature(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: SubmitSignatureDto,
  ) {
    return this.splitsService.submitSignature(id, dto);
  }

  @Post(':id/settle')
  settleSplit(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: SettleSplitDto,
  ) {
    return this.splitsService.settleSplit(id, dto);
  }
}
