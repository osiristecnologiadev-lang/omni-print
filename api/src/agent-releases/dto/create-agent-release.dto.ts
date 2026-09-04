import { Transform } from 'class-transformer';
import { IsBoolean, IsEnum, IsOptional, IsString, Matches } from 'class-validator';
import { AgentPlatform } from '@prisma/client';

// Fields arrive as multipart form strings (see AgentReleasesAdminController)
// - plain @Type(()=>Boolean) would coerce any non-empty string (including
// "false") to true, so mandatory needs an explicit string->boolean Transform
// instead of relying on class-transformer's default coercion.
export class CreateAgentReleaseDto {
  @IsEnum(AgentPlatform)
  platform: AgentPlatform;

  // major.minor.patch only - matches agent/internal/updater's own parser,
  // which doesn't handle pre-release/build-metadata suffixes.
  @Matches(/^\d+\.\d+\.\d+$/, { message: 'version must be in major.minor.patch form, e.g. 0.2.0' })
  version: string;

  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  mandatory?: boolean;

  @IsOptional()
  @IsString()
  releaseNotes?: string;
}
