import { IsArray, IsBoolean, IsIn } from 'class-validator';
import { NotificationType } from '@prisma/client';
import { AUTO_TICKETABLE_TYPES } from '../notifications.service';

// Both required - same reasoning as UpdateNotificationPreferencesDto.
// autoTicketTypes validated against AUTO_TICKETABLE_TYPES (a subset of all
// 6 NotificationType values), not the full enum - UNASSIGNED_DEVICE/
// TICKET_SLA_BREACH are rejected here even via a raw API call, not just
// hidden from the frontend's checkbox list.
export class UpdateTicketAutomationPreferencesDto {
  @IsBoolean()
  autoTicketEnabled: boolean;

  @IsArray()
  @IsIn(AUTO_TICKETABLE_TYPES, { each: true })
  autoTicketTypes: NotificationType[];
}
