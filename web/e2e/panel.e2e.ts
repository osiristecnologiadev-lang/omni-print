import { expect, test, type Page, type TestInfo } from '@playwright/test';

async function shot(page: Page, info: TestInfo, name: string) {
  await page.screenshot({ path: `e2e/screenshots/${info.project.name}/${name}.png`, fullPage: true });
}

// The sidebar is a drawer on phones - only check it on desktop.
const isDesktop = (info: TestInfo) => info.project.name === 'desktop';

// Logged in by auth.setup.ts (saved session).
test.beforeEach(async ({ page }) => {
  await page.goto('/dashboard');
});

test('visão geral e menu agrupado por tarefa', async ({ page }, info) => {
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await shot(page, info, '01-visao-geral');
  if (isDesktop(info)) {
    const nav = page.locator('nav').first();
    for (const group of ['Operação', 'Clientes', 'Faturamento', 'Relatórios', 'Configurações']) {
      await expect(nav.getByText(group, { exact: true }).first()).toBeVisible();
    }
    for (const link of ['Impressoras', 'Contratos', 'Faturas', 'Fechamento do mês', 'Todos os relatórios']) {
      await expect(nav.getByRole('link', { name: link })).toBeVisible();
    }
  }
});

test('Contratos: todos os clientes lado a lado', async ({ page }, info) => {
  await page.goto('/contracts');
  await expect(page.getByRole('heading', { name: 'Contratos' })).toBeVisible();
  await expect(page.getByRole('cell', { name: /Distribuidora Alfa/ })).toBeVisible();
  await expect(page.getByText('Mínimo por impressora').first()).toBeVisible();
  await expect(page.getByText('Por página com mínimo').first()).toBeVisible();
  await expect(page.getByRole('row', { name: /Clínica Gama/ }).getByText('Sem contrato')).toBeVisible();
  await expect(page.getByRole('row', { name: /Clínica Gama/ }).getByRole('link', { name: 'Criar contrato' })).toBeVisible();
  await expect(page.getByText('sem mínimo')).toBeVisible();
  await shot(page, info, '02-contratos');
});

test('Faturas: atrasada destacada, filtro por situação', async ({ page }, info) => {
  await page.goto('/invoices');
  await expect(page.getByRole('heading', { name: 'Faturas' })).toBeVisible();
  await expect(page.getByRole('table').getByText('Atrasada', { exact: true })).toBeVisible();
  await expect(page.getByRole('table').getByText('Paga', { exact: true }).first()).toBeVisible();
  await shot(page, info, '03-faturas');
  await page.goto('/invoices?status=PAID');
  await expect(page.getByRole('table').getByText('Atrasada', { exact: true })).toHaveCount(0);
});

test('Fechamento do mês: pendências visíveis', async ({ page }, info) => {
  await page.goto('/closing');
  await expect(page.getByRole('heading', { name: 'Fechamento do mês' })).toBeVisible();
  await expect(page.getByText(/sem leitura há 3\+ dias/).first()).toBeVisible(); // the stale Kyocera
  await expect(page.getByText(/para revisar/).first()).toBeVisible(); // the OKI
  await shot(page, info, '04-fechamento');
});

test('Relatórios: uma página com todos', async ({ page }, info) => {
  await page.goto('/reports');
  await expect(page.getByRole('heading', { name: 'Relatórios' })).toBeVisible();
  const main = page.getByRole('main');
  await expect(main.getByRole('link', { name: /Páginas por impressora/ })).toBeVisible();
  await expect(main.getByRole('link', { name: /Uso e receita/ })).toBeVisible();
  await shot(page, info, '05-relatorios');
  await page.goto('/reports/pages');
  await expect(page.getByRole('columnheader', { name: 'Modelo' })).toBeVisible();
  await expect(page.getByText('HP LaserJet MFP M426dw').first()).toBeVisible();
  await shot(page, info, '06-paginas-por-impressora');
  await page.goto('/reports/revenue');
  await expect(page.getByRole('heading', { name: 'Uso e receita' })).toBeVisible();
  await shot(page, info, '07-uso-e-receita');
});

test('Cliente em abas', async ({ page }, info) => {
  await page.goto('/customers');
  await page.getByRole('link', { name: /Distribuidora Alfa/ }).first().click();
  const tabs = page.getByRole('navigation', { name: 'Áreas do cliente' });
  await expect(tabs).toBeVisible();
  await shot(page, info, '08-cliente-resumo');

  await tabs.getByRole('link', { name: 'Impressoras' }).click();
  await expect(page.getByRole('heading', { name: 'Impressoras deste cliente' })).toBeVisible();
  await expect(page.getByText('fora do contrato').first()).toBeVisible();
  await shot(page, info, '09-cliente-impressoras');

  await tabs.getByRole('link', { name: 'Configurações' }).click();
  await expect(page.getByRole('heading', { name: 'Dia de fechamento' })).toBeVisible();
  await shot(page, info, '10-cliente-configuracoes');

  await tabs.getByRole('link', { name: 'Contrato' }).click();
  await expect(page.getByRole('navigation', { name: 'Áreas do cliente' }).getByRole('link', { name: 'Contrato' })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await shot(page, info, '11-cliente-contrato');
});

test('Contrato: simulação calcula como a fatura', async ({ page }) => {
  await page.goto('/customers');
  await page.getByRole('link', { name: /Clínica Gama/ }).first().click();
  await page.getByRole('navigation', { name: 'Áreas do cliente' }).getByRole('link', { name: 'Contrato' }).click();

  await page.locator('select[name="pricingModel"]').selectOption('PER_DEVICE_MINIMUM');
  await page.locator('input[name="pricePerPageMono"]').fill('0,042');
  await page.locator('input[name="pricePerPageColor"]').fill('0,042');
  await page.locator('input[name="minimumChargePerDevice"]').fill('250,00');
  await page.locator('[data-sim="mono"]').fill('3174');
  await page.locator('[data-sim="color"]').fill('0');
  await page.locator('[data-sim="printers"]').fill('7');
  // 3.174 págs / 7 x 0,042 < 250 -> every printer pays its minimum.
  await expect(page.getByText('Total do mês').locator('..')).toContainText('1.750,00');
});

test('Impressora: modelo e explicações', async ({ page }, info) => {
  await page.goto('/devices');
  await expect(page.getByRole('heading', { name: 'Impressoras' })).toBeVisible();
  await expect(page.getByRole('columnheader', { name: 'Modelo' })).toBeVisible();
  await shot(page, info, '12-impressoras');
  await page.getByRole('link', { name: /IMP-1/ }).first().click();
  await expect(page.getByText('HP LaserJet MFP M426dw').first()).toBeVisible();
  await expect(page.getByRole('img', { name: /Ajuda:/ }).first()).toBeAttached();
  await shot(page, info, '13-impressora');
});
