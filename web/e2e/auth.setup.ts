import { test as setup } from '@playwright/test';

// Logs in once and saves the session for every test - logging in per test
// trips the API's login rate limit (a real protection, not a bug).
// Login seeded by api/test/e2e-seed.ts - a local test database only.
export const STORAGE = 'e2e/.auth/user.json';

setup('login', async ({ page }) => {
  await page.goto('/login');
  await page.locator('#email').fill('e2e@omniprint.test');
  await page.locator('input[name="password"]').fill('e2e-senha-123');
  await page.getByRole('button', { name: /entrar/i }).click();
  await page.waitForURL(/\/dashboard/);
  await page.context().storageState({ path: STORAGE });
});

// The customer's own read-only login (Distribuidora Alfa, may view invoices)
// - seeded by api/test/e2e-seed.ts.
export const CUSTOMER_STORAGE = 'e2e/.auth/customer.json';

setup('login do cliente', async ({ page }) => {
  await page.goto('/login');
  await page.locator('#email').fill('cliente@alfa.test');
  await page.locator('input[name="password"]').fill('cliente-senha-123');
  await page.getByRole('button', { name: /entrar/i }).click();
  await page.waitForURL(/\/dashboard/);
  await page.context().storageState({ path: CUSTOMER_STORAGE });
});

// OmniPrint's own operator login (/platform), seeded by api/test/e2e-seed.ts.
setup('login da plataforma', async ({ page }) => {
  await page.goto('/platform/login');
  await page.locator('#email').fill('plataforma@omniprint.test');
  await page.locator('#password').fill('plataforma-senha-123');
  await page.getByRole('button', { name: /entrar/i }).click();
  await page.waitForURL(/\/platform$/);
  await page.context().storageState({ path: 'e2e/.auth/platform.json' });
});
