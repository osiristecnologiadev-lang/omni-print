import { IsString, MaxLength } from 'class-validator';

export class UploadLogDto {
  // No @MinLength - a brand-new install can genuinely have an empty log
  // file if "Buscar log agora" is clicked before the agent has logged
  // anything yet (found by testing this for real, not a hypothetical: a
  // just-started local agent's log was still 0 bytes when its first
  // 2-minute check fired). An empty string is a legitimate, honest answer
  // here, not an error. @MaxLength matches the agent's own ~200KB tail
  // read (agent/internal/svc/logtail.go) with headroom - a hard ceiling
  // regardless of what any given agent build actually sends, same
  // defense-in-depth posture as the global 10mb JSON body limit in
  // main.ts.
  @IsString()
  @MaxLength(300_000)
  content: string;
}
