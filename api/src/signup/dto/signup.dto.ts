import { IsEmail, IsNotEmpty, IsOptional, IsString, MinLength } from 'class-validator';

// Public endpoint - stricter than the internal CreateUserDto (platform-admin
// or tenant-admin created accounts don't need a minimum length enforced at
// the API boundary since only trusted staff can hit those routes).
export class SignupDto {
  @IsString()
  @IsNotEmpty()
  companyName: string;

  @IsEmail()
  email: string;

  @IsString()
  @MinLength(8)
  password: string;

  @IsOptional()
  @IsString()
  name?: string;
}
