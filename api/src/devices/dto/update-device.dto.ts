import { IsOptional, IsString, MaxLength } from 'class-validator';

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
}
