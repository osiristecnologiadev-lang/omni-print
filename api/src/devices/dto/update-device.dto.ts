import { IsInt, IsISO8601, IsOptional, IsString, MaxLength, Min, ValidateIf } from 'class-validator';

export class UpdateDeviceDto {
  // Omit or null to unassign (device becomes tenant-wide/unassigned again).
  @IsOptional()
  @IsString()
  customerId?: string | null;

  // Omit to leave unchanged, null/empty string to clear back to the
  // agent-reported name. See Device.customLabel's schema comment.
  @IsOptional()
  @IsString()
  @MaxLength(120)
  customLabel?: string | null;

  // Both set together (a baseline reading needs a date to be meaningful) or
  // both cleared with null - see Device.manualBaselineDate's schema comment.
  @ValidateIf((o) => o.manualBaselineDate !== null)
  @IsOptional()
  @IsISO8601()
  manualBaselineDate?: string | null;

  @ValidateIf((o) => o.manualBaselinePageCount !== null)
  @IsOptional()
  @IsInt()
  @Min(0)
  manualBaselinePageCount?: number | null;
}
