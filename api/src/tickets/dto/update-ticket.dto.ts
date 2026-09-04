import { IsEnum, IsOptional, IsString } from 'class-validator';

export enum TicketStatusDto {
  OPEN = 'OPEN',
  IN_PROGRESS = 'IN_PROGRESS',
  RESOLVED = 'RESOLVED',
  CLOSED = 'CLOSED',
}

export enum TicketPriorityDto {
  LOW = 'LOW',
  MEDIUM = 'MEDIUM',
  HIGH = 'HIGH',
  URGENT = 'URGENT',
}

// Staff-only fields (see TicketsController.update's tenant-wide guard) -
// each only touched when present, same "partial update" convention as
// DevicesService.update/UpdateDeviceDto.
export class UpdateTicketDto {
  @IsOptional()
  @IsEnum(TicketStatusDto)
  status?: TicketStatusDto;

  @IsOptional()
  @IsEnum(TicketPriorityDto)
  priority?: TicketPriorityDto;

  // Pass null to unassign.
  @IsOptional()
  @IsString()
  assignedToUserId?: string | null;
}
