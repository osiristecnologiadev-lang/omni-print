import { Type } from 'class-transformer';
import { IsNumber, IsOptional, Min } from 'class-validator';

export class MarkPaidDto {
  // Defaults to the invoice's totalDue when omitted - only set this when a
  // customer paid a different amount than what was billed (partial payment,
  // a manually agreed discount, etc.).
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  paidAmount?: number;
}
