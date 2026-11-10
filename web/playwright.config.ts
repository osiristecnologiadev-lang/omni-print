import { defineConfig, devices } from '@playwright/test';

// End-to-end tests of the panel against a local stack seeded by
// api/test/e2e-seed.ts (never production). E2E_BASE_URL defaults to the
// local dev panel. Each test also saves a full-page screenshot of the screen
// it checks, desktop and mobile, to e2e/screenshots/ for usability reviews.
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3100',
    locale: 'pt-BR',
    timezoneId: 'America/Sao_Paulo',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'setup', testMatch: /auth\.setup\.ts$/ },
    {
      name: 'desktop',
      testMatch: /.*\.e2e\.ts$/,
      dependencies: ['setup'],
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 }, storageState: 'e2e/.auth/user.json' },
    },
    {
      name: 'mobile',
      testMatch: /.*\.e2e\.ts$/,
      dependencies: ['setup'],
      use: { ...devices['Pixel 7'], storageState: 'e2e/.auth/user.json' },
    },
  ],
});
