import {
  IsEthereumAddress,
  IsISO8601,
  IsOptional,
  IsString,
  Matches,
} from 'class-validator';

export class SubmitSignatureDto {
  @IsEthereumAddress()
  participant!: string;

  @IsString()
  @Matches(/^\d+$/, { message: 'amount deve ser um inteiro em string' })
  amount!: string;

  @IsOptional()
  @IsISO8601()
  deadline?: string;

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
