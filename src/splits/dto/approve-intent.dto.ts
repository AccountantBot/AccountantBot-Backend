import { IsEthereumAddress, IsISO8601, IsOptional } from 'class-validator';

export class ApproveIntentDto {
  @IsEthereumAddress()
  participant!: string;

  @IsOptional()
  @IsISO8601()
  deadline?: string;
}
