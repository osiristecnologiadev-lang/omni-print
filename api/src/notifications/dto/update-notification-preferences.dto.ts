import { IsArray, IsBoolean, IsIn } from 'class-validator';
import { NotificationType } from '@prisma/client';

const NOTIFICATION_TYPES = Object.values(NotificationType);

// Both required - same "an edit with nothing to change isn't a request
// the caller should send" reasoning as UpdateUserPermissionsDto. emailTypes
// not selected is a valid, meaningful value (means "enabled, but nothing
// chosen yet" - see the schema comment on Tenant.notifyEmailEnabled), not
// an error, so it's still required rather than defaulting silently.
export class UpdateNotificationPreferencesDto {
  @IsBoolean()
  emailEnabled: boolean;

  @IsArray()
  @IsIn(NOTIFICATION_TYPES, { each: true })
  emailTypes: NotificationType[];
}
