import { defineConfig, devices } from '@playwright/test';
import { DEMO_SESSION } from './e2e/session';

const external = process.env.E2E_BASE_URL;
const ci = Boolean(process.env.CI);
const accesscore = process.env.ACCESSCORE_URL ?? 'http://localhost:3001';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  forbidOnly: ci,
  retries: ci ? 1 : 0,
  reporter: ci ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: external ?? 'http://localhost:3002',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'setup', testMatch: /.*\.setup\.ts/ },
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], storageState: DEMO_SESSION },
      dependencies: ['setup'],
    },
  ],
  webServer: external
    ? undefined
    : [
        {
          command: 'node dist/main.js',
          cwd: '..',
          url: 'http://localhost:3000/ready',
          reuseExistingServer: !ci,
          timeout: 60_000,
          env: {
            PORT: '3000',
            ACCESSCORE_BASE_URL: accesscore,
            ACCESSCORE_JWKS_URL: `${accesscore}/.well-known/jwks.json`,
            ACCESSCORE_JWT_ISSUER: accesscore,
          },
        },
        {
          command: 'npm start',
          url: 'http://localhost:3002/login',
          reuseExistingServer: !ci,
          timeout: 60_000,
          env: { ACCESSCORE_API_URL: accesscore, MINILEDGER_API_URL: 'http://localhost:3000' },
        },
      ],
});
