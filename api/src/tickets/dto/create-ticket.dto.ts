import { IsEnum, IsOptional, IsString, MinLength } from 'class-validator';

export enum TicketPriorityDto {
  LOW = 'LOW',
  MEDIUM = 'MEDIUM',
  HIGH = 'HIGH',
  URGENT = 'URGENT',
}

export class CreateTicketDto {
  @IsString()
  @MinLength(3)
  subject: string;

  @IsString()
  @MinLength(3)
  description: string;

  @IsOptional()
  @IsEnum(TicketPriorityDto)
  priority?: TicketPriorityDto;

  @IsOptional()
  @IsString()
  deviceId?: string;
}
