import { UnauthorizedException, ExecutionContext } from '@nestjs/common';
import { OpsAlertGuard } from './ops-alert.guard';

function contextWithHeader(authorization?: string): ExecutionContext {
  const req: any = { headers: authorization ? { authorization } : {} };
  return { switchToHttp: () => ({ getRequest: () => req }) } as unknown as ExecutionContext;
}

describe('OpsAlertGuard', () => {
  const originalEnv = process.env.OPS_ALERT_SECRET;
  let guard: OpsAlertGuard;

  beforeEach(() => {
    guard = new OpsAlertGuard();
  });

  afterEach(() => {
    process.env.OPS_ALERT_SECRET = originalEnv;
  });

  it('rejects when OPS_ALERT_SECRET is not configured', () => {
    delete process.env.OPS_ALERT_SECRET;
    expect(() => guard.canActivate(contextWithHeader('Bearer whatever'))).toThrow(UnauthorizedException);
  });

  it('rejects a missing Authorization header', () => {
    process.env.OPS_ALERT_SECRET = 'correct-secret';
    expect(() => guard.canActivate(contextWithHeader())).toThrow(UnauthorizedException);
  });

  it('rejects the wrong secret', () => {
    process.env.OPS_ALERT_SECRET = 'correct-secret';
    expect(() => guard.canActivate(contextWithHeader('Bearer wrong-secret'))).toThrow(UnauthorizedException);
  });

  it('accepts the correct secret', () => {
    process.env.OPS_ALERT_SECRET = 'correct-secret';
    expect(guard.canActivate(contextWithHeader('Bearer correct-secret'))).toBe(true);
  });
});
