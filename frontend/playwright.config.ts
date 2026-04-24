import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  timeout: 45_000,
  retries: 0,
  fullyParallel: false,
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  reporter: [['list']],
  webServer: [
    {
      command: "powershell -Command \"$env:PYTHONPATH=''; Set-Location '..\\backend'; & '..\\.venv\\Scripts\\python.exe' -m uvicorn app.main:app --host 127.0.0.1 --port 8000\"",
      url: 'http://127.0.0.1:8000/health',
      reuseExistingServer: true,
      timeout: 120_000,
    },
    {
      command: "powershell -Command \"$env:VITE_BACKEND_ORIGIN='http://127.0.0.1:8000'; npm run dev -- --host 127.0.0.1 --port 5173\"",
      url: 'http://127.0.0.1:5173',
      reuseExistingServer: true,
      timeout: 120_000,
    },
  ],
})
