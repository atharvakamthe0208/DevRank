import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from '@playwright/test';

const storageState = process.env.PLAYWRIGHT_STORAGE_STATE
  ? resolve(process.env.PLAYWRIGHT_STORAGE_STATE)
  : undefined;

if (storageState && !existsSync(storageState)) {
  throw new Error('PLAYWRIGHT_STORAGE_STATE points to a file that does not exist.');
}

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.ts',
  outputDir: './test-results',
  fullyParallel: true,
  workers: 2,
  reporter: [
    ['list'],
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
  ],
  use: {
    baseURL: 'http://127.0.0.1:5173',
    browserName: 'chromium',
    headless: true,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium' }],
  webServer: {
    command: 'npm run build --workspace @devrank/contracts && npm run dev --workspace @devrank/web -- --host 127.0.0.1 --port 5173 --strictPort',
    url: 'http://127.0.0.1:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
