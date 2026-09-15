import { IsEmail, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

// Shown on the invoice PDF's "cliente" block - see Customer's schema
// comment. Renaming a customer isn't exposed here on purpose: name is also
// how devices/users/tokens are grouped and displayed everywhere else, and
// changing it wasn't asked for - keep this endpoint to the new fields only.
//
// slaHours*: each accepts a positive integer to set a per-customer SLA
// override, or null to explicitly clear it back to the global default (see
// common/sla.util.ts) - undefined (the field just isn't in the request
// body) leaves whatever was already set untouched, same "only touch what's
// present" convention as DevicesService.update.
export class UpdateCustomerDto {
  @IsOptional() @IsString() @MaxLength(32) document?: string;
  @IsOptional() @IsString() @MaxLength(300) address?: string;

  // Same null-clears/undefined-leaves-untouched convention as slaHours*
  // below - see the schema comment on Customer.notifyEmail for what this
  // actually controls.
  @IsOptional() @IsEmail() @MaxLength(200) notifyEmail?: string | null;

  @IsOptional() @IsInt() @Min(0) @Max(999) slaHoursLow?: number | null;
  @IsOptional() @IsInt() @Min(0) @Max(999) slaHoursMedium?: number | null;
  @IsOptional() @IsInt() @Min(0) @Max(999) slaHoursHigh?: number | null;
  @IsOptional() @IsInt() @Min(0) @Max(999) slaHoursUrgent?: number | null;
}
