import { defineConfig, devices } from "@playwright/test"

export default defineConfig({
  testDir: "./tests",
  testMatch: "observation-lab.spec.ts",
  use: {
    ...devices["Desktop Chrome"],
    channel: "chrome",
    baseURL: "http://127.0.0.1:4012",
  },
  reporter: "list",
  webServer: {
    command: "bun run dev -- --host 127.0.0.1 --port 4012",
    url: "http://127.0.0.1:4012",
    reuseExistingServer: false,
  },
})
