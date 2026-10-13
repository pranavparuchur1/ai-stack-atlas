import { defineConfig, devices } from "@playwright/test";

// Smoke test against the production build (vite preview), with the committed seed snapshot.
export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  use: { baseURL: "http://localhost:4179", trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } }],
  webServer: {
    command: "npm run build && npx vite preview --port 4179 --strictPort",
    url: "http://localhost:4179",
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
