import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  globalSetup: './tests/e2e/global-setup.ts',
  timeout: 90_000,
  workers: 1,
  reporter: [['list']],
  use: { trace: 'retain-on-failure' },
  // Evidence probes (feasibility measurements) run only with: npm run test:probes
  grepInvert: process.env.SNAPMEET_PROBES ? undefined : /@probe/,
  grep: process.env.SNAPMEET_PROBES ? /@probe/ : undefined,
});
