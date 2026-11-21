// @ts-check
import { defineConfig, devices } from '@playwright/test';

/**
 * AuroMind Modernization Batch B17.3
 * Playwright E2E Test Suite Configuration
 *
 * Configured for real-browser testing against deterministic local static server.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: [
    ['list'],
    ['html', { outputFolder: 'test-results/playwright-report', open: 'never' }]
  ],
  outputDir: 'test-results/artifacts',

  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'off',
    headless: true,
    viewport: { width: 1280, height: 800 },
    ignoreHTTPSErrors: true
  },

  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        channel: 'msedge'
      }
    },
    {
      name: 'mobile-chromium',
      use: {
        ...devices['iPhone SE'],
        channel: 'msedge'
      }
    }
  ],

  webServer: {
    command: 'node server.js',
    url: 'http://localhost:3000/health',
    reuseExistingServer: !process.env.CI,
    timeout: 10000
  }
});
