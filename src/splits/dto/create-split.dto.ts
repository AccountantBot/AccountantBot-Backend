import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsBoolean,
  IsEthereumAddress,
  IsISO8601,
  IsOptional,
  IsString,
  Matches,
  ValidateNested,
} from 'class-validator';

export class SplitLegDto {
  @IsEthereumAddress()
  participant!: string;

  @IsString()
  @Matches(/^\d+$/, { message: 'amount deve ser um inteiro em string' })
  amount!: string;
}

export class CreateSplitDto {
  @IsEthereumAddress()
  payer!: string;

  @IsEthereumAddress()
  token!: string;

  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => SplitLegDto)
  legs!: SplitLegDto[];

  @IsOptional()
  @IsISO8601()
  deadline?: string;

  @IsOptional()
  @Matches(/^0x[a-fA-F0-9]{64}$/, {
    message: 'metaHash deve ser um hex de 32 bytes',
  })
  metaHash?: string;

  @IsOptional()
  @IsBoolean()
  createOnchain?: boolean;
}
