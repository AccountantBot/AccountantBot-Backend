import { IsString, IsNotEmpty } from 'class-validator';

export class LinkWalletDto {
  @IsString()
  @IsNotEmpty()
  telegram: string;

  @IsString()
  @IsNotEmpty()
  pubkey: string;
}
