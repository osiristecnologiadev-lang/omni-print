import { IsOptional, IsString } from 'class-validator';

export class CreateEnrollmentCodeDto {
  @IsOptional()
  @IsString()
  label?: string;
}
