import { expect, test } from '@playwright/test';

// Flows that WRITE: create a customer and its contract, generate and pay an
// invoice, take a printer out of the contract and back, open and comment a
// ticket, resolve a notification, create a user from a profile, confirm a
// destructive action. They create their own customer ("Fluxo Teste") and
// run once, in the 'flows' project, after every read-only desktop and phone
// check (playwright.config.ts) - so those always see the seeded data.

const CUSTOMER = 'Fluxo Teste';

test('cliente novo -> contrato -> fatura -> paga', async ({ page }) => {
  await page.goto('/customers');
  await page.getByPlaceholder('Nome do cliente').fill(CUSTOMER);
  await page.getByRole('button', { name: 'Adicionar' }).click();
  await page.getByRole('link', { name: CUSTOMER }).click();

  const tabs = page.getByRole('navigation', { name: 'Áreas do cliente' });
  await tabs.getByRole('link', { name: 'Contrato' }).click();
  await page.locator('select[name="pricingModel"]').selectOption('FLAT_RATE');
  await page.locator('input[name="startDate"]').fill('2026-01-01');
  await page.locator('input[name="fixedFee"]').fill('1.500,00'); // Brazilian thousands separator
  await page.getByRole('button', { name: 'Criar contrato' }).click();
  await expect(page.getByText('Contrato salvo.')).toBeVisible();
  await expect(page.getByText(/R\$\s1\.500,00/).first()).toBeVisible();

  await page.getByRole('navigation', { name: 'Áreas do cliente' }).getByRole('link', { name: 'Faturas' }).click();
  await expect(page.getByRole('heading', { name: 'Gerar fatura' })).toBeVisible();
  const prev = new Date();
  prev.setDate(1);
  prev.setMonth(prev.getMonth() - 1);
  await page.locator('select[name="month"]').selectOption(String(prev.getMonth() + 1));
  await page.locator('select[name="year"]').selectOption(String(prev.getFullYear()));
  await expect(page.locator('select[name="month"]')).toHaveValue(String(prev.getMonth() + 1));
  await page.getByRole('button', { name: 'Gerar' }).click();
  await expect(page.getByText(/R\$\s1\.500,00/).first()).toBeVisible();

  await page.getByRole('button', { name: 'Marcar como paga' }).click();
  await expect(page.getByText('Paga', { exact: true }).first()).toBeVisible();

  // The cross-customer list shows it as paid too.
  await page.goto('/invoices?status=PAID');
  await expect(page.getByRole('table').getByText(CUSTOMER)).toBeVisible();
});

test('impressora: fora do contrato e de volta', async ({ page }) => {
  await page.goto('/devices');
  await page.getByRole('link', { name: /IMP-2/ }).first().click();
  await page.getByRole('button', { name: 'Marcar como fora do contrato' }).click();
  await expect(page.getByRole('heading', { name: /fora do contrato/ })).toBeVisible();
  await page.getByRole('button', { name: 'Incluir no contrato' }).click();
  await expect(page.getByRole('heading', { name: /entra no contrato/ })).toBeVisible();
});

test('chamado: abrir e comentar', async ({ page }) => {
  await page.goto('/tickets/new');
  await page.locator('select[name="customerId"]').selectOption({ label: CUSTOMER });
  await page.getByRole('button', { name: /Continuar/ }).click();
  await page.locator('input[name="subject"]').fill('Impressora fazendo barulho');
  await page.locator('textarea[name="description"]').fill('Barulho alto ao puxar o papel.');
  await page.locator('select[name="priority"]').selectOption('HIGH');
  await page.getByRole('button', { name: /Abrir chamado/ }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Impressora fazendo barulho' })).toBeVisible();
  await page.getByPlaceholder('Escreva um comentário...').fill('Vamos trocar o rolete.');
  await page.getByRole('button', { name: 'Comentar' }).click();
  await expect(page.getByText('Vamos trocar o rolete.')).toBeVisible();
});

test('notificação: resolver', async ({ page }) => {
  await page.goto('/notifications');
  const card = page.locator('div', { hasText: 'IMP-7 (OKI ES5112)' }).filter({ has: page.getByRole('button', { name: 'Resolver' }) }).last();
  await card.getByRole('button', { name: 'Resolver' }).click();
  await expect(page.getByText('Resolvidas', { exact: false }).first()).toBeVisible();
});

test('usuário novo a partir de um perfil', async ({ page }) => {
  await page.goto('/users');
  await page.getByPlaceholder('Nome').fill('Pessoa do Financeiro');
  await page.getByPlaceholder('E-mail').fill('financeiro@outsourcing.test');
  await page.getByPlaceholder('Senha (mín. 8 caracteres)').fill('senha-fin-123');
  // Nothing comes checked - pick the profile.
  const createForm = page.locator('form').filter({ has: page.getByRole('button', { name: 'Criar usuário' }) });
  await expect(createForm.locator('input[name="permissions"]:checked')).toHaveCount(0);
  await createForm.getByRole('button', { name: 'Financeiro' }).click();
  await expect(createForm.locator('input[name="permissions"]:checked')).not.toHaveCount(0);
  await page.getByRole('button', { name: 'Criar usuário' }).click();
  await expect(page.getByText('financeiro@outsourcing.test')).toBeVisible();
});

test('ação destrutiva pede confirmação (cancelar contrato)', async ({ page }) => {
  await page.goto('/customers');
  await page.getByRole('link', { name: CUSTOMER }).click();
  await page.getByRole('navigation', { name: 'Áreas do cliente' }).getByRole('link', { name: 'Contrato' }).click();

  // First click only asks.
  await page.getByText('Cancelar contrato', { exact: true }).click();
  await expect(page.getByText(/deixa de ser cobrado/)).toBeVisible();
  await expect(page.getByText('Contrato ativo').first()).toBeVisible();

  await page.getByRole('button', { name: 'Sim, cancelar contrato' }).click();
  await page.goto('/contracts');
  await expect(page.getByRole('row', { name: new RegExp(CUSTOMER) }).getByText('Sem contrato')).toBeVisible();
});
