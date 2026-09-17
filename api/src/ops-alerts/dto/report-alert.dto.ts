import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class ReportAlertDto {
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  message: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  path?: string;
}
