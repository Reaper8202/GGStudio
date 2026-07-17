import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests',
  timeout: 90_000,
  use: {
    baseURL: 'http://localhost:4183',
    viewport: { width: 1280, height: 720 },
  },
  webServer: {
    command: 'npx vite preview --port 4183 --strictPort',
    url: 'http://localhost:4183',
    reuseExistingServer: !process.env.CI,
  },
});
