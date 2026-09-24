import { IsEnum } from 'class-validator';
import { AgentCommandType } from '@prisma/client';

export class RequestCommandDto {
  @IsEnum(AgentCommandType)
  command: AgentCommandType;
}
