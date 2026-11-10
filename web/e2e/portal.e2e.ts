import { expect, test } from '@playwright/test';

// What a customer's own login sees (Distribuidora Alfa): only its printers
// and invoices, none of the outsourcing company's commercial screens, and
// never another customer's data - even by typing the address.
test.use({ storageState: 'e2e/.auth/customer.json' });

test('cliente vê só o que é dele', async ({ page }, info) => {
  await page.goto('/dashboard');
  await expect(page.getByText('Algo deu errado')).toHaveCount(0);
  await page.screenshot({ path: `e2e/screenshots/${info.project.name}/40-portal-cliente.png`, fullPage: true });

  await page.goto('/devices');
  const rows = page.locator('main tbody tr');
  await expect(rows).toHaveCount(4); // Alfa's 4 printers, nothing from Beta/Gama
  await expect(page.getByText('Cartório Beta')).toHaveCount(0);
  await expect(page.getByText('Clínica Gama')).toHaveCount(0);

  if (info.project.name === 'desktop') {
    const nav = page.locator('nav').first();
    for (const hidden of ['Contratos', 'Faturas', 'Clientes', 'Usuários', 'Empresa']) {
      await expect(nav.getByRole('link', { name: hidden, exact: true })).toHaveCount(0);
    }
  }

  // Its own invoices are reachable from the menu (it has invoices_view).
  await page.goto('/dashboard');
  if (info.project.name === 'desktop') {
    await page.locator('nav').first().getByRole('link', { name: 'Minhas faturas' }).click();
  } else {
    await page.goto((await page.locator('a', { hasText: 'Minhas faturas' }).first().getAttribute('href'))!);
  }
  await expect(page.getByRole('heading', { level: 1, name: 'Faturas' })).toBeVisible();
  await expect(page.getByText(/1\.036,20/).first()).toBeVisible();
});

test('cliente não abre telas da empresa nem de outro cliente', async ({ page }) => {
  for (const path of ['/contracts', '/invoices', '/customers', '/closing', '/users']) {
    const res = await page.goto(path);
    const body = await page.locator('body').innerText();
    // forbidden() / redirect - never the page itself with data.
    expect(res!.status() === 403 || /não tem permissão|acesso negado|403|forbidden/i.test(body) || !page.url().endsWith(path)).toBe(true);
    await expect(page.getByText('Cartório Beta')).toHaveCount(0);
  }
});
