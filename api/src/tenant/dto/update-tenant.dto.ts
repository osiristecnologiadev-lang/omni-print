import { IsOptional, IsString, MaxLength } from 'class-validator';

// All optional and all just for display on the invoice PDF's issuer block
// (see Tenant's schema comment) - no format validation on document (CNPJ
// format varies by entity type, and this isn't a legal/NF-e field).
export class UpdateTenantDto {
  @IsOptional() @IsString() @MaxLength(200) name?: string;
  @IsOptional() @IsString() @MaxLength(32) document?: string;
  @IsOptional() @IsString() @MaxLength(300) address?: string;
  @IsOptional() @IsString() @MaxLength(32) phone?: string;
  @IsOptional() @IsString() @MaxLength(200) contactEmail?: string;
}
