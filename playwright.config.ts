import { defineConfig } from "@playwright/test";
import path from "node:path";

export default defineConfig({
  testDir: "./tests",
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:4175",
    channel: "chrome",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "npm run db:reset && npm start",
    url: "http://127.0.0.1:4175",
    reuseExistingServer: false,
    timeout: 30_000,
    env: {
      ...process.env,
      PORT: "4175",
      HALARA_DATA_DIR: path.resolve(".test", "data"),
      NODE_ENV: "development",
    },
  },
});
