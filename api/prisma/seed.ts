// Idempotent-ish dev seed: reuses existing rows if they're already there
// (so it doesn't fragment the real device data already ingested across
// separate re-seeds), and creates/prints credentials for the three kinds of
// login the app has - a platform admin (OmniPrint's own operator, sees
// every tenant), a tenant-wide user (one outsourcing company's own staff,
// sees every one of their customers), and a customer-scoped user (that
// customer's own staff, sees only their assigned devices).
import { PrismaClient } from '@prisma/client';
import { randomBytes, createHash } from 'crypto';
import * as bcrypt from 'bcryptjs';
import { generateAgentTokenDigits, formatAgentTokenDigits } from '../src/auth/agent-token.util';
import { defaultPermissionsFor } from '../src/auth/permissions.util';

const prisma = new PrismaClient();

async function upsertUser(opts: {
  tenantId: string;
  customerId: string | null;
  email: string;
  password: string;
  name: string;
  permissions?: string[];
}) {
  const existing = await prisma.user.findUnique({ where: { email: opts.email } });
  if (existing) return existing;
  const passwordHash = await bcrypt.hash(opts.password, 10);
  return prisma.user.create({
    data: {
      tenantId: opts.tenantId,
      customerId: opts.customerId,
      email: opts.email,
      passwordHash,
      name: opts.name,
      permissions: opts.permissions ?? defaultPermissionsFor(opts.customerId),
    },
  });
}

async function main() {
  // --- Platform admin (OmniPrint's own operator - see platform/ module) ---
  const platformAdminPassword = 'admin123';
  let platformAdmin = await prisma.platformAdmin.findUnique({ where: { email: 'admin@omniprint.dev' } });
  if (!platformAdmin) {
    const passwordHash = await bcrypt.hash(platformAdminPassword, 10);
    platformAdmin = await prisma.platformAdmin.create({
      data: { email: 'admin@omniprint.dev', passwordHash, name: 'Admin OmniPrint' },
    });
    console.log('Platform admin created:', platformAdmin.email);
  } else {
    console.log('Platform admin already exists:', platformAdmin.email);
  }

  // --- Tenant: MultiTonner (an outsourcing company - a platform admin's
  // customer, distinct from the customers MultiTonner itself has) ---
  let tenant =
    (await prisma.tenant.findFirst({ where: { name: 'MultiTonner' } })) ??
    (await prisma.tenant.findFirst({ where: { name: 'Dev Tenant' } })); // pre-rename dev DBs
  if (!tenant) {
    // ACTIVE, not TRIALING - this seed represents an established dev/demo
    // tenant, not a fresh signup that should be gated by a trial.
    tenant = await prisma.tenant.create({
      data: { name: 'MultiTonner', subscriptionStatus: 'ACTIVE', trialEndsAt: new Date() },
    });
    console.log('Tenant created:', tenant.id);
  } else {
    if (tenant.name !== 'MultiTonner') {
      tenant = await prisma.tenant.update({ where: { id: tenant.id }, data: { name: 'MultiTonner' } });
      console.log('Renamed existing tenant to "MultiTonner":', tenant.id);
    } else {
      console.log('Reusing existing tenant:', tenant.id);
    }
  }

  const existingAgentToken = await prisma.agentToken.findFirst({ where: { tenantId: tenant.id, customerId: null } });
  if (!existingAgentToken) {
    const token = randomBytes(32).toString('hex');
    const tokenHash = createHash('sha256').update(token).digest('hex');
    await prisma.agentToken.create({ data: { tenantId: tenant.id, tokenHash, label: 'local-dev-agent' } });
    console.log('Agent token (copy into agent/config.yaml as agent_token - shown once):');
    console.log(token);
  } else {
    console.log('Agent token already exists for this tenant (not re-created/shown).');
  }

  // Tenant-wide login lives at @multitonner.dev now, not @omniprint.dev -
  // that address is the platform admin's, a separate person/login entirely.
  const adminPassword = 'admin123';
  let admin = await prisma.user.findUnique({ where: { email: 'admin@multitonner.dev' } });
  if (!admin) {
    const legacyAdmin = await prisma.user.findUnique({ where: { email: 'admin@omniprint.dev' } });
    if (legacyAdmin) {
      admin = await prisma.user.update({ where: { id: legacyAdmin.id }, data: { email: 'admin@multitonner.dev' } });
      console.log('Renamed existing tenant admin to admin@multitonner.dev');
    } else {
      admin = await upsertUser({
        tenantId: tenant.id,
        customerId: null,
        email: 'admin@multitonner.dev',
        password: adminPassword,
        name: 'Admin MultiTonner',
      });
    }
  }

  let customer = await prisma.customer.findFirst({ where: { tenantId: tenant.id, name: 'Empresa Cliente Teste' } });
  if (!customer) {
    customer = await prisma.customer.create({ data: { tenantId: tenant.id, name: 'Empresa Cliente Teste' } });
  }

  const customerPassword = 'cliente123';
  const customerUser = await upsertUser({
    tenantId: tenant.id,
    customerId: customer.id,
    email: 'cliente@empresa-teste.dev',
    password: customerPassword,
    name: 'Usuario Empresa Teste',
    // Granted out of the box (rather than the empty-array default) so local
    // manual verification of the invoices_view capability doesn't require
    // editing permissions by hand first.
    permissions: ['invoices_view'],
  });

  // Give the scoped login something real to see, if there are unassigned
  // devices lying around from earlier ingest testing.
  const unassigned = await prisma.device.findMany({
    where: { tenantId: tenant.id, customerId: null },
    take: 3,
  });
  if (unassigned.length > 0) {
    await prisma.device.updateMany({
      where: { id: { in: unassigned.map((d) => d.id) } },
      data: { customerId: customer.id },
    });
    console.log(`Assigned ${unassigned.length} existing device(s) to customer "${customer.name}"`);
  }

  // A customer-scoped agent token, demonstrating the real onboarding flow:
  // this is what would go into the config.yaml of an agent installed at
  // this specific customer's site, so its discoveries are tagged with this
  // customer automatically (see agent-auth.guard.ts / ingest.service.ts).
  const existingCustomerToken = await prisma.agentToken.findFirst({ where: { customerId: customer.id } });
  let customerAgentTokenDigits: string | null = null;
  if (!existingCustomerToken) {
    customerAgentTokenDigits = generateAgentTokenDigits();
    const tokenHash = createHash('sha256').update(customerAgentTokenDigits).digest('hex');
    await prisma.agentToken.create({
      data: { tenantId: tenant.id, customerId: customer.id, tokenHash, label: 'seed-customer-agent' },
    });
  }

  console.log('');
  console.log('--- Dashboard logins ---');
  console.log(`Platform admin (sees every tenant): ${platformAdmin.email} / ${platformAdminPassword}`);
  console.log(`Tenant-wide, "MultiTonner" (sees every customer): ${admin.email} / ${adminPassword}`);
  console.log(`Customer-scoped (sees only "${customer.name}"): ${customerUser.email} / ${customerPassword}`);

  if (customerAgentTokenDigits) {
    console.log('');
    console.log(`Agent token for customer "${customer.name}" (copy into that site's agent/config.yaml, shown once):`);
    console.log(formatAgentTokenDigits(customerAgentTokenDigits));
  } else {
    console.log(`Customer "${customer.name}" already has an agent token (not re-created/shown).`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
