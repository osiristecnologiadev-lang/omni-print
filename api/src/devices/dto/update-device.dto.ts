import { IsBoolean, IsInt, IsISO8601, IsNumber, IsOptional, IsString, MaxLength, Min, ValidateIf } from 'class-validator';

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

  // See Device.billingExcluded's schema comment.
  @IsOptional()
  @IsBoolean()
  billingExcluded?: boolean;

  // PER_DEVICE_MINIMUM contracts - null clears back to the contract default.
  @ValidateIf((o) => o.minimumChargeOverride !== null)
  @IsOptional()
  @IsNumber()
  @Min(0)
  minimumChargeOverride?: number | null;

  // See Device.billEngineCounter.
  @IsOptional()
  @IsBoolean()
  billEngineCounter?: boolean;
}
