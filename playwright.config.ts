import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: 'http://127.0.0.1:3100',
    headless: true,
    launchOptions: {
      executablePath: process.env.CHROME_PATH || (process.env.CI ? undefined : '/opt/google/chrome/chrome'),
      args: ['--no-sandbox'],
    },
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run start -- --port 3100',
    url: 'http://127.0.0.1:3100',
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
