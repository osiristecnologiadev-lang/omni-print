import { BadRequestException, ForbiddenException } from '@nestjs/common';
import {
  assertInvoiceReadAccess,
  assertPermission,
  defaultPermissionsFor,
  hasPermission,
  TENANT_ONLY_PERMISSION_KEYS,
  validatePermissionsForScope,
} from './permissions.util';

describe('defaultPermissionsFor', () => {
  it('gives a tenant-wide user (customerId null) every tenant-only key', () => {
    expect(defaultPermissionsFor(null)).toEqual([...TENANT_ONLY_PERMISSION_KEYS]);
  });

  it('gives a customer-scoped user nothing', () => {
    expect(defaultPermissionsFor('cust-1')).toEqual([]);
  });
});

describe('validatePermissionsForScope', () => {
  it('accepts tenant-only keys for a tenant-wide user', () => {
    expect(() => validatePermissionsForScope(null, ['contracts', 'devices'])).not.toThrow();
  });

  it('rejects a tenant-only key for a customer-scoped user', () => {
    expect(() => validatePermissionsForScope('cust-1', ['contracts'])).toThrow(BadRequestException);
  });

  it('rejects invoices_view for a tenant-wide user', () => {
    expect(() => validatePermissionsForScope(null, ['invoices_view'])).toThrow(BadRequestException);
  });

  it('accepts invoices_view for a customer-scoped user', () => {
    expect(() => validatePermissionsForScope('cust-1', ['invoices_view'])).not.toThrow();
  });
});

describe('hasPermission / assertPermission', () => {
  it('hasPermission reflects the permissions array, including when absent entirely', () => {
    expect(hasPermission({ permissions: ['contracts'] }, 'contracts')).toBe(true);
    expect(hasPermission({ permissions: ['contracts'] }, 'devices')).toBe(false);
    expect(hasPermission({}, 'contracts')).toBe(false);
  });

  it('assertPermission throws ForbiddenException when missing', () => {
    expect(() => assertPermission({ permissions: [] }, 'contracts')).toThrow(ForbiddenException);
  });

  it('assertPermission does not throw when present', () => {
    expect(() => assertPermission({ permissions: ['contracts'] }, 'contracts')).not.toThrow();
  });
});

describe('assertInvoiceReadAccess', () => {
  it('allows a tenant-wide user with invoices to read any customer', () => {
    expect(() =>
      assertInvoiceReadAccess({ customerId: null, permissions: ['invoices'] }, 'any-customer'),
    ).not.toThrow();
  });

  it('rejects a tenant-wide user missing invoices', () => {
    expect(() => assertInvoiceReadAccess({ customerId: null, permissions: [] }, 'any-customer')).toThrow(
      ForbiddenException,
    );
  });

  it('allows a customer-scoped user with invoices_view to read their own customer', () => {
    expect(() =>
      assertInvoiceReadAccess({ customerId: 'c1', permissions: ['invoices_view'] }, 'c1'),
    ).not.toThrow();
  });

  it('rejects a customer-scoped user with invoices_view reading a different customer', () => {
    expect(() => assertInvoiceReadAccess({ customerId: 'c1', permissions: ['invoices_view'] }, 'c2')).toThrow(
      ForbiddenException,
    );
  });

  it('rejects a customer-scoped user without invoices_view entirely', () => {
    expect(() => assertInvoiceReadAccess({ customerId: 'c1', permissions: [] }, 'c1')).toThrow(ForbiddenException);
  });
});
