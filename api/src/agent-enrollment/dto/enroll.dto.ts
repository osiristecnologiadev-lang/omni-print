import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class EnrollDto {
  @IsString()
  @IsNotEmpty()
  // Defensive bound only - real codes are 8 chars - just stops someone
  // POSTing a multi-MB string into hashToken().
  @MaxLength(64)
  code!: string;
}
