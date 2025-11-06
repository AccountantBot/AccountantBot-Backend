import { Type } from 'class-transformer';
import {
  IsArray,
  IsEthereumAddress,
  IsOptional,
  IsString,
  Matches,
  ValidateNested,
} from 'class-validator';

export class SettleItemDto {
  @IsEthereumAddress()
  participant!: string;

  @IsString()
  @Matches(/^\d+$/, { message: 'amount deve ser um inteiro em string' })
  amount!: string;

  @IsString()
  @Matches(/^\d+$/, { message: 'deadline deve ser unix timestamp em string' })
  deadline!: string;

  @IsString()
  @Matches(/^0x[a-fA-F0-9]{64}$/, {
    message: 'salt deve ser um hex de 32 bytes',
  })
  salt!: string;

  @IsString()
  @Matches(/^0x[a-fA-F0-9]{130}$/i, {
    message: 'signature deve ser um hex válido de 65 bytes',
  })
  signature!: string;
}

export class SettleSplitDto {
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SettleItemDto)
  items?: SettleItemDto[];
}
