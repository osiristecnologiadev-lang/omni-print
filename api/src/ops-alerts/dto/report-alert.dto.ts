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

  // Which caller this alert actually came from (e.g. "db-backup") - lets
  // OpsAlertService.notify pick the right plain-language explanation
  // instead of every caller of this shared webhook being mislabeled as
  // "web" (see that service's SOURCE_INFO). Optional and defaults to
  // 'web' in the controller, since the original caller (web/'s own
  // instrumentation.ts) predates this field and never sends it.
  @IsOptional()
  @IsString()
  @MaxLength(50)
  source?: string;
}
