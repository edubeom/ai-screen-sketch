import { defineConfig, devices } from '@playwright/test';

// 브라우저로 직접 확인하는 시험 (light-check). 빌드한 정적 앱을 preview 서버로 띄운다.
export default defineConfig({
  testDir: 'e2e',
  timeout: 120_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    ...devices['Desktop Chrome'],
    baseURL: 'http://localhost:4173',
    viewport: { width: 1600, height: 1000 },
    acceptDownloads: true,
  },
  webServer: {
    command: 'npm run build && npm run preview -- --strictPort',
    url: 'http://localhost:4173',
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
