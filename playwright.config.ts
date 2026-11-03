import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests against production builds (service worker included), served by `vite preview`:
 *  - local-*  : the local-only build (GitHub Pages / `npm run dev` behaviour)
 *  - cloud-*  : the Vercel build, with /api/* answered by an in-memory fake (e2e/fakeCloud.ts)
 * Run with `npm run test:e2e`; the HTML report lands in playwright-report/.
 */
const LOCAL = 'http://localhost:5180/ProjectManagement/';
const CLOUD = 'http://localhost:5181/';

export default defineConfig({
  testDir: 'e2e',
  outputDir: 'test-results',
  timeout: 30_000,
  expect: { timeout: 7_000 },
  fullyParallel: true,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never' }], ['json', { outputFile: 'test-results/results.json' }]],
  use: { trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [
    { name: 'local-chromium', testDir: 'e2e/local', use: { ...devices['Desktop Chrome'], baseURL: LOCAL } },
    { name: 'local-firefox', testDir: 'e2e/local', use: { ...devices['Desktop Firefox'], baseURL: LOCAL } },
    { name: 'local-webkit', testDir: 'e2e/local', use: { ...devices['Desktop Safari'], baseURL: LOCAL } },
    { name: 'local-mobile', testDir: 'e2e/local', use: { ...devices['Pixel 7'], baseURL: LOCAL } },
    // Service workers are blocked so every /api call reaches the fake; push.spec re-enables them.
    { name: 'cloud-chromium', testDir: 'e2e/cloud', use: { ...devices['Desktop Chrome'], baseURL: CLOUD, serviceWorkers: 'block' } },
    { name: 'cloud-firefox', testDir: 'e2e/cloud', use: { ...devices['Desktop Firefox'], baseURL: CLOUD, serviceWorkers: 'block' } },
  ],
  webServer: [
    {
      command: 'npx vite build --outDir dist-e2e-local --emptyOutDir && npx vite preview --outDir dist-e2e-local --port 5180 --strictPort',
      url: LOCAL,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: { VERCEL: '' },
    },
    {
      command: 'npx vite build --outDir dist-e2e-cloud --emptyOutDir && npx vite preview --outDir dist-e2e-cloud --port 5181 --strictPort',
      url: CLOUD,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: { VERCEL: '1' },
    },
  ],
});
