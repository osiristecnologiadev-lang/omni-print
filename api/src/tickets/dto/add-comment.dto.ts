import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional, IsString, MinLength } from 'class-validator';

export class AddCommentDto {
  @IsString()
  @MinLength(1)
  body: string;

  // Arrives as a multipart form string, not a real boolean - see
  // CreateAgentReleaseDto's identical comment on why a plain
  // @Type(()=>Boolean) would be wrong here (it coerces "false" to true).
  // Whether this is actually honored (only a tenant-wide staff caller may
  // set it) is enforced in TicketsService.addComment, not here.
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  internal?: boolean;
}
