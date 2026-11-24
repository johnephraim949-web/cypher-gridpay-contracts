import { defineConfig } from '@playwright/test';

// Issue #361 scaffolding. WEB_BASE_URL must point at a running GridPay web app
// (none exists on main yet); specs that need the app are skipped when unset.
const baseURL = process.env.WEB_BASE_URL;

export default defineConfig({
  testDir: './specs',
  fullyParallel: true,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  expect: { toHaveScreenshot: { maxDiffPixelRatio: 0.01 } },
  use: { baseURL, trace: 'on-first-retry' },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1440, height: 900 } } },
    { name: 'mobile', use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
  ],
});
