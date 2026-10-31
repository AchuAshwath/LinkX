import { defineConfig, devices } from "@playwright/test"

export default defineConfig({
  testDir: "./tests",
  testMatch: "ai-chat-scroll.spec.ts",
  use: {
    baseURL: "http://127.0.0.1:4000",
    ...devices["Desktop Chrome"],
    channel: "chrome",
  },
  projects: [{ name: "chat-scroll", use: { browserName: "chromium" } }],
})
