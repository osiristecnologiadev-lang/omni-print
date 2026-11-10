// Seeds a throwaway database with a realistic small tenant for the panel's
// end-to-end tests (web/e2e). Run: DATABASE_URL=<test db> npx ts-node test/e2e-seed.ts
// Test-only login (local test database only, never production):
//   e2e@omniprint.test / e2e-senha-123 (company), cliente@alfa.test / cliente-senha-123
//   (customer portal), plataforma@omniprint.test / plataforma-senha-123 (/platform)
import * as bcrypt from 'bcryptjs';
import { ContractPricingModel } from '@prisma/client';
import { connect, reset } from './db';

export const E2E_EMAIL = 'e2e@omniprint.test';
export const E2E_PASSWORD = 'e2e-senha-123';

const DAY = 24 * 60 * 60 * 1000;
const PERMISSIONS = ['contracts', 'invoices', 'customers', 'agent', 'agent_logs', 'users', 'devices', 'tickets', 'reports', 'audit_log', 'settings', 'notifications', 'billing'];

async function main() {
  const { prisma } = connect();
  await reset(prisma);
  await prisma.user.deleteMany({});

  const tenant = await prisma.tenant.create({
    data: { name: 'Outsourcing Exemplo', trialEndsAt: new Date(Date.now() + 365 * DAY), subscriptionStatus: 'ACTIVE' },
  });
  const admin = await prisma.user.create({
    data: { tenantId: tenant.id, email: E2E_EMAIL, name: 'Usuário E2E', passwordHash: await bcrypt.hash(E2E_PASSWORD, 10), permissions: PERMISSIONS },
  });

  const now = Date.now();
  const start = new Date(Date.UTC(2026, 6, 1));

  async function printer(customerId: string, n: number, opts: { model: [string, string]; perDay: number; color?: number; excluded?: boolean; review?: boolean; stale?: boolean }) {
    const d = await prisma.device.create({
      data: {
        tenantId: tenant.id,
        customerId,
        host: `10.0.${n}.${10 + n}`,
        name: `IMP-${n}`,
        printerName: `IMP-${n}`,
        serialNumber: `SN${1000 + n}`,
        manufacturer: opts.model[0],
        model: opts.model[1],
        billingExcluded: opts.excluded ?? false,
        reviewPending: opts.review ?? false,
      },
    });
    // One reading a day since July; a "stale" printer stopped 6 days ago.
    const stop = opts.stale ? now - 6 * DAY : now;
    let mono = 50_000 + n * 1_000;
    let color = 2_000;
    for (let t = start.getTime(); t <= stop; t += DAY) {
      mono += opts.perDay;
      color += opts.color ?? 0;
      await prisma.metric.create({
        data: {
          deviceId: d.id,
          collectedAt: new Date(t + 12 * 60 * 60 * 1000),
          online: true,
          pageCount: BigInt(mono + color),
          ...(opts.color != null ? { monoPageCount: BigInt(mono), colorPageCount: BigInt(color) } : {}),
          supplies: [{ description: 'Black Toner', class: 'consumed', level: Math.max(5, 90 - Math.floor((t - start.getTime()) / DAY) % 85), max: 100, colorant: 'black' }],
        },
      });
    }
    return d;
  }

  // Cliente A - mínimo por impressora, fecha dia 1
  const a = await prisma.customer.create({ data: { tenantId: tenant.id, name: 'Distribuidora Alfa', billingCycleDay: 1 } });
  await prisma.contract.create({
    data: {
      tenantId: tenant.id, customerId: a.id, pricingModel: ContractPricingModel.PER_DEVICE_MINIMUM, startDate: start, billingDay: 15,
      pricePerPageMono: 0.042, pricePerPageColor: 0.042, minimumChargePerDevice: 250,
    },
  });
  await printer(a.id, 1, { model: ['HP', 'LaserJet MFP M426dw'], perDay: 300 });
  await printer(a.id, 2, { model: ['Brother', 'HL-L5100DN'], perDay: 40 });
  await printer(a.id, 3, { model: ['Kyocera', 'ECOSYS M3655idn'], perDay: 120, stale: true });
  await printer(a.id, 4, { model: ['HP', 'LaserJet E50145'], perDay: 80, excluded: true });

  // Cliente B - por página, fecha dia 28, com colorida de preço próprio
  const b = await prisma.customer.create({ data: { tenantId: tenant.id, name: 'Cartório Beta', billingCycleDay: 28 } });
  await prisma.contract.create({
    data: {
      tenantId: tenant.id, customerId: b.id, pricingModel: ContractPricingModel.PER_PAGE, startDate: start, billingDay: 28,
      pricePerPageMono: 0.06, pricePerPageColor: 0.95, minimumPagesMono: 0, minimumPagesColor: 0,
    },
  });
  await printer(b.id, 5, { model: ['Samsung', 'M4080FX'], perDay: 500 });
  const colorPrinter = await printer(b.id, 6, { model: ['HP', 'Color LaserJet MFP M180nw'], perDay: 60, color: 25 });
  await prisma.device.update({ where: { id: colorPrinter.id }, data: { colorPagePriceOverride: 0.75 } });
  await printer(b.id, 7, { model: ['OKI', 'ES5112'], perDay: 10, review: true, excluded: true });

  // Cliente C - sem contrato ainda
  const c = await prisma.customer.create({ data: { tenantId: tenant.id, name: 'Clínica Gama', billingCycleDay: 1 } });
  await printer(c.id, 8, { model: ['Epson', 'WF-C5790'], perDay: 90, color: 30 });

  // Invoices: one paid (Sept), one pending and overdue (Oct)
  const contractA = await prisma.contract.findFirstOrThrow({ where: { customerId: a.id } });
  await prisma.invoice.create({
    data: {
      tenantId: tenant.id, customerId: a.id, contractId: contractA.id, pricingModel: contractA.pricingModel,
      periodStart: new Date(Date.UTC(2026, 8, 1)), periodEnd: new Date(Date.UTC(2026, 9, 1) - 1), dueDate: new Date(Date.UTC(2026, 9, 15)),
      totalPages: 13_600, perDevice: [], totalDue: 1_000, usageCost: 1_000, status: 'PAID', paidAt: new Date(Date.UTC(2026, 9, 14)), paidAmount: 1_000,
    },
  });
  await prisma.invoice.create({
    data: {
      tenantId: tenant.id, customerId: a.id, contractId: contractA.id, pricingModel: contractA.pricingModel,
      periodStart: new Date(Date.UTC(2026, 9, 1)), periodEnd: new Date(Date.UTC(2026, 10, 1) - 1), dueDate: new Date(Date.UTC(2026, 10, 5)),
      totalPages: 14_100, perDevice: [], totalDue: 1_036.2, usageCost: 1_036.2, status: 'PENDING',
    },
  });

  // Help desk: an open urgent ticket past its SLA, one in progress, one resolved.
  const imp1 = await prisma.device.findFirstOrThrow({ where: { tenantId: tenant.id, name: 'IMP-1' } });
  const t1 = await prisma.ticket.create({
    data: {
      tenantId: tenant.id, customerId: a.id, deviceId: imp1.id, subject: 'Atolamento de papel na bandeja 2',
      description: 'A impressora da recepção atola papel toda vez que usa a bandeja 2.', priority: 'URGENT',
      createdByUserId: admin.id, slaDueAt: new Date(now - 2 * 60 * 60 * 1000),
    },
  });
  await prisma.ticketComment.create({ data: { ticketId: t1.id, authorUserId: admin.id, body: 'Técnico agendado para amanhã de manhã.' } });
  await prisma.ticket.create({
    data: {
      tenantId: tenant.id, customerId: b.id, subject: 'Toner acabando na colorida', description: 'Pedido de toner ciano.',
      status: 'IN_PROGRESS', priority: 'MEDIUM', assignedToUserId: admin.id, slaDueAt: new Date(now + 20 * 60 * 60 * 1000),
    },
  });
  await prisma.ticket.create({
    data: {
      tenantId: tenant.id, customerId: c.id, subject: 'Instalar impressora nova', description: 'Configurar a Epson na rede.',
      status: 'RESOLVED', priority: 'LOW', slaDueAt: new Date(now - 5 * DAY), resolvedAt: new Date(now - 6 * DAY),
    },
  });

  // Notifications the panel shows in the bell / Notificações.
  await prisma.notification.createMany({
    data: [
      { tenantId: tenant.id, type: 'OVERDUE_INVOICE', dedupeKey: 'e2e-1', title: 'Fatura vencida', body: 'Fatura de Distribuidora Alfa vencida em 05/11/2026 (R$ 1.036,20).', customerId: a.id, linkHref: `/customers/${a.id}/invoices` },
      { tenantId: tenant.id, type: 'DEVICE_REVIEW', dedupeKey: 'e2e-2', title: 'Impressora nova para revisar', body: 'IMP-7 (OKI ES5112) foi encontrada fora da rede do agente de Cartório Beta.', customerId: b.id },
      { tenantId: tenant.id, type: 'TICKET_SLA_BREACH', dedupeKey: 'e2e-3', title: 'Chamado fora do SLA', body: 'Atolamento de papel na bandeja 2 passou do prazo.', customerId: a.id, readAt: new Date() },
    ],
  });

  // A customer login (read-only portal) and some audit history.
  await prisma.user.create({
    data: { tenantId: tenant.id, customerId: a.id, email: 'cliente@alfa.test', name: 'Compras Alfa', passwordHash: await bcrypt.hash('cliente-senha-123', 10), permissions: ['invoices_view'] },
  });
  await prisma.auditLogEntry.createMany({
    data: [
      { tenantId: tenant.id, actorType: 'USER', actorId: admin.id, actorLabel: E2E_EMAIL, action: 'contract.create', targetType: 'Contract', targetId: contractA.id, targetLabel: 'Contrato PER_DEVICE_MINIMUM' },
      { tenantId: tenant.id, actorType: 'USER', actorId: admin.id, actorLabel: E2E_EMAIL, action: 'device.update', targetType: 'Device', targetId: imp1.id, targetLabel: 'IMP-1' },
    ],
  });

  // OmniPrint's own operator (the /platform area) - a separate login.
  await prisma.platformAdmin.deleteMany({ where: { email: 'plataforma@omniprint.test' } });
  await prisma.platformAdmin.create({
    data: { email: 'plataforma@omniprint.test', name: 'Operador E2E', passwordHash: await bcrypt.hash('plataforma-senha-123', 10) },
  });

  await prisma.$disconnect();
  console.log(`seeded tenant ${tenant.id} - login ${E2E_EMAIL}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
