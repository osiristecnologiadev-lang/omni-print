import { ArgumentsHost, BadRequestException, HttpException, NotFoundException } from '@nestjs/common';
import { AllExceptionsFilter } from './all-exceptions.filter';
import type { OpsAlertService } from './ops-alerts.service';

// BaseExceptionFilter normally gets its applicationRef via Nest's own
// Optional/Inject-decorated httpAdapterHost property, populated by the DI
// container - constructed directly here (no Nest TestingModule, same
// precedent as devices.controller.spec.ts), so it's stubbed the same way
// the container would have wired it, letting super.catch() run for real
// rather than mocking it away.
function fakeHost(req: any) {
  const reply = jest.fn();
  const end = jest.fn();
  const host = {
    switchToHttp: () => ({ getRequest: () => req }),
    getArgByIndex: () => ({}),
  } as unknown as ArgumentsHost;
  return { host, applicationRef: { isHeadersSent: () => false, reply, end }, reply, end };
}

describe('AllExceptionsFilter', () => {
  let opsAlertService: { notify: jest.Mock };
  let filter: AllExceptionsFilter;

  beforeEach(() => {
    opsAlertService = { notify: jest.fn().mockResolvedValue(undefined) };
    filter = new AllExceptionsFilter(opsAlertService as unknown as OpsAlertService);
  });

  function wireApplicationRef(applicationRef: unknown) {
    (filter as any).httpAdapterHost = { httpAdapter: applicationRef };
  }

  it('alerts and still responds normally for an unhandled (non-HttpException) error', () => {
    const { host, applicationRef, reply } = fakeHost({ method: 'GET', originalUrl: '/v1/devices' });
    wireApplicationRef(applicationRef);

    filter.catch(new Error('db connection lost'), host);

    expect(opsAlertService.notify).toHaveBeenCalledWith('api', 'GET /v1/devices - db connection lost', expect.any(String));
    expect(reply).toHaveBeenCalled();
  });

  it('alerts on a 500-level HttpException', () => {
    const { host, applicationRef, reply } = fakeHost({ method: 'POST', originalUrl: '/v1/x' });
    wireApplicationRef(applicationRef);

    filter.catch(new HttpException('upstream failed', 502), host);

    expect(opsAlertService.notify).toHaveBeenCalled();
    expect(reply).toHaveBeenCalled();
  });

  it('does NOT alert on a 404 - normal traffic, not an incident', () => {
    const { host, applicationRef, reply } = fakeHost({ method: 'GET', originalUrl: '/v1/missing' });
    wireApplicationRef(applicationRef);

    filter.catch(new NotFoundException('not found'), host);

    expect(opsAlertService.notify).not.toHaveBeenCalled();
    expect(reply).toHaveBeenCalled();
  });

  it('does NOT alert on a 400 validation error', () => {
    const { host, applicationRef, reply } = fakeHost({ method: 'POST', originalUrl: '/v1/x' });
    wireApplicationRef(applicationRef);

    filter.catch(new BadRequestException('bad input'), host);

    expect(opsAlertService.notify).not.toHaveBeenCalled();
    expect(reply).toHaveBeenCalled();
  });
});
