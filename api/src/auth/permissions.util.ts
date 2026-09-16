import { BadRequestException, ForbiddenException } from '@nestjs/common';

// Module-level access, layered on top of the customerId scope (see User
// model comment in prisma/schema.prisma). 11 of these 12 keys are only ever
// valid for a tenant-wide user (customerId null - the outsourcing company's
// own staff); invoices_view is the one key only valid for a customer-scoped
// user (that customer's own login) - it's the sole capability a client can
// be granted beyond the always-open device-read/ticket-create/comment
// access every customer-scoped login already has unconditionally.
export const TENANT_ONLY_PERMISSION_KEYS = [
  'contracts',
  'invoices',
  'customers',
  'agent',
  'users',
  'devices',
  'tickets',
  'reports',
  'audit_log',
  'settings',
  'notifications',
  // Deliberately separate from 'settings' - the outsource's OmniPrint bill
  // (payment method, invoices, cancel) is sensitive enough that the user
  // wanted it gated on its own, not bundled with general company settings.
  // See SubscriptionController - every mutating route requires this.
  'billing',
] as const;

export const CUSTOMER_ONLY_PERMISSION_KEYS = ['invoices_view'] as const;

export const PERMISSION_KEYS = [...TENANT_ONLY_PERMISSION_KEYS, ...CUSTOMER_ONLY_PERMISSION_KEYS] as const;

export type PermissionKey = (typeof PERMISSION_KEYS)[number];

// What a NEW user gets when the request omits permissions entirely - same
// lockout-avoidance reasoning as the migration's backfill UPDATE (see
// migration.sql for user_permissions): a tenant-wide user created without
// thinking about the new checkboxes still gets today's de facto full
// access, a customer-scoped user still gets none of the new capability.
export function defaultPermissionsFor(customerId: string | null): PermissionKey[] {
  return customerId ? [] : [...TENANT_ONLY_PERMISSION_KEYS];
}

// Cross-field check (depends on customerId, so it can't live on the DTO's
// per-field decorators) - rejects a tenant-only key for a customer-scoped
// user and vice versa. Called from UsersService.create/updatePermissions,
// not the controller, so it applies identically to both entry points.
export function validatePermissionsForScope(customerId: string | null, keys: string[]): void {
  const allowed: readonly string[] = customerId ? CUSTOMER_ONLY_PERMISSION_KEYS : TENANT_ONLY_PERMISSION_KEYS;
  const invalid = keys.filter((key) => !allowed.includes(key));
  if (invalid.length > 0) {
    throw new BadRequestException(
      customerId
        ? `permission(s) not valid for a customer-scoped user: ${invalid.join(', ')}`
        : `permission(s) not valid for a tenant-wide user: ${invalid.join(', ')}`,
    );
  }
}

export function hasPermission(req: { permissions?: string[] }, key: PermissionKey): boolean {
  return req.permissions?.includes(key) ?? false;
}

// Closes the privilege-escalation hole the 'users' permission would
// otherwise open: without this, anyone holding just 'users' (and nothing
// else) could grant themselves - or a brand-new throwaway account they
// just created - every other permission, since neither UsersService.create
// nor .updatePermissions checked the ACTOR's own permissions before, only
// that the target's scope allowed the requested keys at all.
// Only applies to a tenant-wide target: a customer-scoped target's only
// assignable key (invoices_view, from CUSTOMER_ONLY_PERMISSION_KEYS) isn't
// an escalation vector for the actor, who is necessarily tenant-wide
// themselves and structurally can never hold - or gain anything by
// granting - a customer-scoped key.
// oldPermissions lets an actor save an unrelated change (via the same
// "all checkboxes" form) without being forced to also strip a permission
// the TARGET already legitimately had but the actor themselves doesn't
// hold - only a permission newly appearing in newPermissions that wasn't
// already on the target is checked against the actor's own set.
export function assertNoPrivilegeEscalation(
  actorPermissions: string[],
  customerId: string | null,
  oldPermissions: string[],
  newPermissions: string[],
): void {
  if (customerId) return;
  const newlyGranted = newPermissions.filter((key) => !oldPermissions.includes(key));
  const ungranted = newlyGranted.filter((key) => !actorPermissions.includes(key));
  if (ungranted.length > 0) {
    throw new ForbiddenException(`you cannot grant permission(s) you don't have yourself: ${ungranted.join(', ')}`);
  }
}

// Replaces every assertTenantWide/inline `if (req.customerId) throw ...`
// call site in this codebase. Safe as a single uniform check (no per-route
// special-casing) because validatePermissionsForScope makes it structurally
// impossible for a customer-scoped user's permissions array to ever contain
// one of the 11 tenant-only keys.
export function assertPermission(req: { permissions?: string[] }, key: PermissionKey): void {
  if (!hasPermission(req, key)) {
    throw new ForbiddenException(`missing permission: ${key}`);
  }
}

// The one non-uniform check: reading invoices for targetCustomerId is
// allowed for a tenant-wide user with full `invoices` (any customer), OR a
// customer-scoped user with `invoices_view` reading their OWN customerId
// only - same "URL param must match req.customerId" shape as
// TicketsController's existing assertScopeMatches.
export function assertInvoiceReadAccess(
  req: { customerId: string | null; permissions?: string[] },
  targetCustomerId: string,
): void {
  if (!req.customerId) {
    assertPermission(req, 'invoices');
    return;
  }
  if (req.customerId === targetCustomerId && hasPermission(req, 'invoices_view')) {
    return;
  }
  throw new ForbiddenException('missing permission: invoices_view');
}
