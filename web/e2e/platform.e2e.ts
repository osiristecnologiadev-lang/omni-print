import { expect, test } from '@playwright/test';

// OmniPrint's own operator area (/platform): every screen opens, shows the
// seeded company, and a company login cannot get in.
test.use({ storageState: 'e2e/.auth/platform.json' });

test('plataforma: empresas, frota, releases, auditoria', async ({ page }, info) => {
  const shot = (name: string) => page.screenshot({ path: `e2e/screenshots/${info.project.name}/${name}.png`, fullPage: true });

  await page.goto('/platform');
  await expect(page.getByRole('heading', { level: 1, name: 'Empresas outsource' })).toBeVisible();
  await expect(page.getByText('Outsourcing Exemplo').first()).toBeVisible();
  await shot('50-plataforma-empresas');

  await page.getByText('Outsourcing Exemplo').first().click();
  await expect(page.getByRole('heading', { level: 1, name: 'Outsourcing Exemplo' })).toBeVisible();
  await shot('51-plataforma-empresa');

  for (const [path, heading, name] of [
    ['/platform/agent-fleet', 'Frota de agentes', '52-plataforma-frota'],
    ['/platform/agent-releases', 'Releases do agente', '53-plataforma-releases'],
    ['/platform/audit-log', 'Log de auditoria', '54-plataforma-auditoria'],
  ] as const) {
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible();
    await expect(page.getByText('Algo deu errado')).toHaveCount(0);
    await shot(name);
  }
});

test('login de empresa não entra na plataforma', async ({ browser }) => {
  const ctx = await browser.newContext({ storageState: 'e2e/.auth/user.json' });
  const page = await ctx.newPage();
  await page.goto('/platform');
  await expect(page).toHaveURL(/\/platform\/login/);
  await ctx.close();
});
