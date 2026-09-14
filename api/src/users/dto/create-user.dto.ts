import { IsArray, IsEmail, IsIn, IsOptional, IsString, MinLength } from 'class-validator';
import { PERMISSION_KEYS } from '../../auth/permissions.util';

export class CreateUserDto {
  @IsEmail()
  email: string;

  @IsString()
  @MinLength(8)
  password: string;

  @IsOptional()
  @IsString()
  name?: string;

  // Omit or null for a tenant-wide user; set to scope this login to one
  // customer - see User model comment in prisma/schema.prisma.
  @IsOptional()
  @IsString()
  customerId?: string | null;

  // Which modules this user gets - see auth/permissions.util.ts. Omit to
  // fall back to defaultPermissionsFor(customerId) (full access for a
  // tenant-wide user, none for a customer-scoped one - see that function's
  // comment). UsersService.create cross-checks these against customerId via
  // validatePermissionsForScope, which the @IsIn here can't express since it
  // has no access to the sibling customerId field.
  @IsOptional()
  @IsArray()
  @IsIn(PERMISSION_KEYS, { each: true })
  permissions?: string[];
}
