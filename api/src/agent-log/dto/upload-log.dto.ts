import { IsString, Matches, MaxLength } from 'class-validator';

export class UploadLogDto {
  // The agent-local calendar day this content covers (agent/internal/config's
  // DatedLogPath rotation) - lets the API keep one history row per day
  // instead of overwriting a single blob. Plain YYYY-MM-DD, not a full
  // ISO datetime: it's a calendar day label, not an instant.
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  date: string;

  // No @MinLength - a brand-new install can genuinely have an empty log
  // file if "Buscar log agora" is clicked before the agent has logged
  // anything yet (found by testing this for real, not a hypothetical: a
  // just-started local agent's log was still 0 bytes when its first
  // 2-minute check fired). An empty string is a legitimate, honest answer
  // here, not an error. @MaxLength matches the agent's own whole-file read
  // (agent/internal/svc/logtail.go's readLogFile, capped at
  // maxLogFileBytes) with headroom - a hard ceiling regardless of what any
  // given agent build actually sends, same defense-in-depth posture as the
  // global 10mb JSON body limit in main.ts. Raised from the old 300_000
  // (a ~200KB-tail-only design) once the agent started sending the WHOLE
  // day's rotated log instead of just a tail - a user complained the tail
  // cut made real analysis harder.
  @IsString()
  @MaxLength(2_000_000)
  content: string;
}
