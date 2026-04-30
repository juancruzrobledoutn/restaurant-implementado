import { defineConfig, devices } from '@playwright/test'
import dotenv from 'dotenv'
import path from 'path'

// Load test environment variables — .env.test is gitignored, .env.test.example is committed
dotenv.config({ path: path.resolve(__dirname, '.env.test') })

const BASE_URL_DASHBOARD = process.env.BASE_URL_DASHBOARD ?? 'http://localhost:5177'
const BASE_URL_MENU = process.env.BASE_URL_MENU ?? 'http://localhost:5176'
const BASE_URL_WAITER = process.env.BASE_URL_WAITER ?? 'http://localhost:5178'

export default defineConfig({
  // All E2E specs live under tests/ with subdirs per app
  testDir: './tests',
  testMatch: '**/*.spec.ts',

  globalSetup: './global-setup.ts',

  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? '50%' : undefined,

  reporter: process.env.CI
    ? [['html', { open: 'never' }], ['github']]
    : [['html', { open: 'on-failure' }]],

  timeout: 300_000,
  expect: { timeout: 8_000 },

  use: {
    // Global defaults — overridden per project below
    actionTimeout: 10_000,
    navigationTimeout: 20_000,
    // D-04: video on-first-retry, screenshot only-on-failure
    video: 'on-first-retry',
    screenshot: 'only-on-failure',
    trace: 'on-first-retry',
  },

  projects: [
    // ── Dashboard (Desktop Chrome, port 5177) ─────────────────────────────
    {
      name: 'dashboard',
      testMatch: '**/dashboard/**/*.spec.ts',
      use: {
        ...devices['Desktop Chrome'],
        baseURL: BASE_URL_DASHBOARD,
      },
    },
    // ── pwaMenu (Mobile Safari, port 5176) ────────────────────────────────
    {
      name: 'pwa-menu',
      testMatch: '**/pwa-menu/**/*.spec.ts',
      use: {
        ...devices['iPhone 13'],
        baseURL: BASE_URL_MENU,
      },
    },
    // ── pwaWaiter (Mobile Chrome, port 5178) ──────────────────────────────
    {
      name: 'pwa-waiter',
      testMatch: '**/pwa-waiter/**/*.spec.ts',
      use: {
        ...devices['Pixel 5'],
        baseURL: BASE_URL_WAITER,
      },
    },
    // ── Cross-app touch target regression (Mobile Chrome, WCAG 2.5.5 AA) ──
    {
      name: 'touch-targets',
      testMatch: '**/touch-targets.spec.ts',
      use: {
        ...devices['Pixel 5'],
        baseURL: BASE_URL_MENU,
      },
    },
  ],
})
