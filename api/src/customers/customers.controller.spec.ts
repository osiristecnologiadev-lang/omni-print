import { CustomersController } from './customers.controller';
import type { CustomersService } from './customers.service';
import type { AuditLogService } from '../audit-log/audit-log.service';

// One of this feature's two headline examples ("quem revogou um token") -
// confirms revoking an agent token produces a matching audit entry with the
// real actor identity from the request (set by UserAuthGuard).
//
// Constructed directly (not via Nest's TestingModule) - this app has no
// prior controller-level spec, and TestingModule tries to fully resolve
// @UseGuards(UserAuthGuard)'s own dependency chain (JwtService etc.) even
// though these tests call the controller method directly and never go
// through HTTP/guards at all. Plain instantiation is the correct scope
// for "unit test this one class."
describe('CustomersController audit logging', () => {
  let controller: CustomersController;
  let customersService: { revokeToken: jest.Mock };
  let auditLog: { log: jest.Mock };

  beforeEach(() => {
    customersService = { revokeToken: jest.fn() };
    auditLog = { log: jest.fn() };
    controller = new CustomersController(
      customersService as unknown as CustomersService,
      auditLog as unknown as AuditLogService,
    );
  });

  it('logs agent_token.revoke with the real actor and token identity', async () => {
    const req = { tenantId: 't1', customerId: null, userId: 'u1', userEmail: 'admin@example.com' };
    customersService.revokeToken.mockResolvedValue({ id: 'tok1', label: 'Matriz', revokedAt: new Date() });

    await controller.revokeToken(req, 'c1', 'tok1');

    expect(auditLog.log).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 't1',
        actorType: 'USER',
        actorId: 'u1',
        actorLabel: 'admin@example.com',
        action: 'agent_token.revoke',
        targetType: 'AgentToken',
        targetId: 'tok1',
        targetLabel: 'Matriz',
      }),
    );
  });

  it('falls back to a generic label when the token has none', async () => {
    const req = { tenantId: 't1', customerId: null, userId: 'u1', userEmail: 'admin@example.com' };
    customersService.revokeToken.mockResolvedValue({ id: 'tok2', label: null, revokedAt: new Date() });

    await controller.revokeToken(req, 'c1', 'tok2');

    expect(auditLog.log).toHaveBeenCalledWith(expect.objectContaining({ targetLabel: 'Sem rótulo' }));
  });
});
