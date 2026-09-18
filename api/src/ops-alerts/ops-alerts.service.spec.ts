import { OpsAlertService } from './ops-alerts.service';
import type { EmailService } from '../email/email.service';

describe('OpsAlertService', () => {
  const originalEmail = process.env.OPS_ALERT_EMAIL;
  let emailService: { send: jest.Mock };
  let service: OpsAlertService;

  beforeEach(() => {
    process.env.OPS_ALERT_EMAIL = 'ops@example.com';
    emailService = { send: jest.fn().mockResolvedValue(undefined) };
    service = new OpsAlertService(emailService as unknown as EmailService);
  });

  afterEach(() => {
    process.env.OPS_ALERT_EMAIL = originalEmail;
    jest.restoreAllMocks();
  });

  it('does nothing when OPS_ALERT_EMAIL is not set', async () => {
    delete process.env.OPS_ALERT_EMAIL;
    await service.notify('api', 'boom');
    expect(emailService.send).not.toHaveBeenCalled();
  });

  it('sends an email with the given source/message on the first call', async () => {
    await service.notify('api', 'GET /v1/devices - boom', 'stack trace here');

    expect(emailService.send).toHaveBeenCalledTimes(1);
    const call = emailService.send.mock.calls[0][0];
    expect(call.to).toBe('ops@example.com');
    expect(call.subject).toContain('API');
    expect(call.text).toContain('GET /v1/devices - boom');
    expect(call.text).toContain('stack trace here');
  });

  it('explains a catalogued source in plain language', async () => {
    await service.notify('db-backup', 'pg_dump exited non-zero');

    const call = emailService.send.mock.calls[0][0];
    expect(call.subject).toContain('Backup diário do banco de dados');
    expect(call.text).toContain('backup noturno');
  });

  it('still sends, with a generic explanation, for an uncatalogued source', async () => {
    await service.notify('some-new-thing', 'boom');

    const call = emailService.send.mock.calls[0][0];
    expect(call.subject).toContain('some-new-thing');
    expect(call.text).toContain('Origem não catalogada');
  });

  it('suppresses a second alert within the cooldown window', async () => {
    await service.notify('api', 'first');
    await service.notify('web', 'second, still within cooldown');
    expect(emailService.send).toHaveBeenCalledTimes(1);
  });

  it('sends again once the cooldown has passed', async () => {
    // Realistic (non-zero) timestamps - starting at 0 would coincidentally
    // match the service's own initial lastSentAt=0 field and make the
    // first call look like it's still within the cooldown.
    const start = 1_700_000_000_000;
    jest
      .spyOn(Date, 'now')
      .mockReturnValueOnce(start)
      .mockReturnValueOnce(start + 6 * 60_000);
    await service.notify('api', 'first');
    await service.notify('api', 'after cooldown');
    expect(emailService.send).toHaveBeenCalledTimes(2);
  });

  it('never throws when EmailService.send rejects', async () => {
    emailService.send.mockRejectedValue(new Error('resend down'));
    await expect(service.notify('api', 'boom')).resolves.toBeUndefined();
  });
});
