import { IsArray, IsIn } from 'class-validator';
import { PERMISSION_KEYS } from '../../auth/permissions.util';

// Unlike CreateUserDto's permissions field, this one is required - an edit
// with nothing to change is just not a request the caller should send.
export class UpdateUserPermissionsDto {
  @IsArray()
  @IsIn(PERMISSION_KEYS, { each: true })
  permissions: string[];
}
