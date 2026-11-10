import { expect, test, type Page, type TestInfo } from '@playwright/test';

// Every remaining screen of the panel opens without an error page and shows
// what it is for; each one is screenshotted (desktop + phone) for the
// usability reviews. Data from api/test/e2e-seed.ts.
async function shot(page: Page, info: TestInfo, name: string) {
  await page.screenshot({ path: `e2e/screenshots/${info.project.name}/${name}.png`, fullPage: true });
}

async function open(page: Page, path: string, heading: string | RegExp) {
  await page.goto(path);
  await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible();
  await expect(page.getByText('Algo deu errado')).toHaveCount(0);
}

test('Clientes', async ({ page }, info) => {
  await open(page, '/customers', 'Clientes');
  await expect(page.getByRole('link', { name: /Distribuidora Alfa/ })).toBeVisible();
  await shot(page, info, '20-clientes');
});

test('Chamados: lista, detalhe e novo', async ({ page }, info) => {
  await open(page, '/tickets', 'Chamados');
  await expect(page.getByText('Atolamento de papel na bandeja 2')).toBeVisible();
  // What needs action first: the urgent ticket past its SLA tops the list,
  // the resolved one is last.
  const subjects = await page.locator('main a[href^="/tickets/"]').allInnerTexts();
  const real = subjects.filter((x) => !/abrir chamado/i.test(x));
  expect(real[0]).toContain('Atolamento de papel');
  expect(real[real.length - 1]).toContain('Instalar impressora nova');
  await shot(page, info, '21-chamados');
  await page.getByRole('link', { name: /Atolamento de papel/ }).first().click();
  await expect(page.getByText('Técnico agendado para amanhã de manhã.')).toBeVisible();
  await shot(page, info, '22-chamado');
  await open(page, '/tickets/new', 'Abrir chamado');
  await shot(page, info, '23-chamado-novo');
});

test('Notificações', async ({ page }, info) => {
  await open(page, '/notifications', 'Notificações');
  await expect(page.getByText('Impressora nova para revisar').first()).toBeVisible();
  // The notifications come before their settings.
  const notifY = (await page.getByText('Fatura de Distribuidora Alfa vencida').boundingBox())!.y;
  const settingsY = (await page.getByText('Configurar avisos por e-mail').boundingBox())!.y;
  expect(notifY).toBeLessThan(settingsY);
  await shot(page, info, '24-notificacoes');
});

test('Usuários', async ({ page }, info) => {
  await open(page, '/users', 'Usuários');
  await expect(page.getByText('cliente@alfa.test')).toBeVisible();
  await shot(page, info, '25-usuarios');
});

test('Empresa', async ({ page }, info) => {
  await open(page, '/settings', 'Dados da empresa');
  await shot(page, info, '26-empresa');
});

test('Instalar agente', async ({ page }, info) => {
  await open(page, '/agent-download', 'Instalar o agente');
  await shot(page, info, '27-instalar-agente');
});

test('Logs do agente', async ({ page }, info) => {
  await open(page, '/logs', 'Logs do agente');
  await shot(page, info, '28-logs');
});

test('Log de auditoria', async ({ page }, info) => {
  await open(page, '/audit-log', 'Log de auditoria');
  await expect(page.getByText('IMP-1').first()).toBeVisible();
  await shot(page, info, '29-auditoria');
});

test('Assinatura', async ({ page }, info) => {
  await open(page, '/subscribe', 'Assinatura do OmniPrint');
  await shot(page, info, '30-assinatura');
});
