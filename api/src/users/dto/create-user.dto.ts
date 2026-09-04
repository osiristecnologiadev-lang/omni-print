import { IsEmail, IsOptional, IsString, MinLength } from 'class-validator';

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
}
