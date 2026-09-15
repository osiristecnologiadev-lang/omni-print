import { TicketsController } from './tickets.controller';
import type { TicketsService } from './tickets.service';

// Only downloadAttachment() touches the filesystem (createReadStream(...).pipe(res))
// - stubbed out so these tests exercise the scoping logic only, not real I/O
// or stream/response wiring.
jest.mock('fs', () => ({
  ...jest.requireActual('fs'),
  createReadStream: jest.fn(() => ({ pipe: jest.fn() })),
}));

// A staff caller hits the exact same customer-scoped routes as the customer
// does (the ticket detail page always binds to the ticket's own customerId
// regardless of who's viewing - see actions.ts). A real regression: get()
// and downloadAttachment() used to forward the URL's :customerId straight
// through, which is always truthy - that made TicketsService treat a staff
// caller as customer-scoped too, wrongly hiding internal notes and blocking
// staff from downloading their own internal-note attachments. Both must
// forward req.customerId (null for staff) instead.
describe('TicketsController staff-vs-customer scope', () => {
  let controller: TicketsController;
  let ticketsService: { get: jest.Mock; getAttachmentForDownload: jest.Mock };

  const staffReq = { tenantId: 't1', customerId: null, userId: 'staff1' };
  const customerReq = { tenantId: 't1', customerId: 'cust1', userId: 'cust-user1' };

  beforeEach(() => {
    ticketsService = { get: jest.fn(), getAttachmentForDownload: jest.fn() };
    controller = new TicketsController(ticketsService as unknown as TicketsService);
  });

  it('get(): passes null (not the URL customerId) when a staff caller uses the customer-scoped route', async () => {
    await controller.get(staffReq, 'cust1', 't1');

    expect(ticketsService.get).toHaveBeenCalledWith('t1', null, 't1');
  });

  it('get(): passes the real customerId when the caller is customer-scoped', async () => {
    await controller.get(customerReq, 'cust1', 't1');

    expect(ticketsService.get).toHaveBeenCalledWith('t1', 'cust1', 't1');
  });

  it('downloadAttachment(): passes null (not the URL customerId) for a staff caller', async () => {
    ticketsService.getAttachmentForDownload.mockResolvedValue({
      mimeType: 'image/png',
      filename: 'a.png',
      storedPath: '/tmp/fake-path',
    });
    const res = { setHeader: jest.fn() } as any;

    await controller.downloadAttachment(staffReq, 'cust1', 't1', 'att1', res);

    expect(ticketsService.getAttachmentForDownload).toHaveBeenCalledWith('t1', null, 't1', 'att1');
  });

  it('downloadAttachment(): passes the real customerId for a customer-scoped caller', async () => {
    ticketsService.getAttachmentForDownload.mockResolvedValue({
      mimeType: 'image/png',
      filename: 'a.png',
      storedPath: '/tmp/fake-path',
    });
    const res = { setHeader: jest.fn() } as any;

    await controller.downloadAttachment(customerReq, 'cust1', 't1', 'att1', res);

    expect(ticketsService.getAttachmentForDownload).toHaveBeenCalledWith('t1', 'cust1', 't1', 'att1');
  });
});
