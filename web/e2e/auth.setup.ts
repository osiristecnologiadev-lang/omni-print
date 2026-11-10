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
