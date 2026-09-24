import { IsISO8601, IsString, MaxLength } from 'class-validator';

export class AckCommandDto {
  // Echoed back exactly as GET /v1/agent/command returned it - identifies
  // which request this ack answers (see AgentCommandService.ack).
  @IsISO8601()
  requestedAt: string;

  // Shown as-is in the customer page ("Já está na versão mais recente",
  // "3 impressoras encontradas, 1 nova", ...) - a short sentence, not a log.
  @IsString()
  @MaxLength(500)
  result: string;
}
