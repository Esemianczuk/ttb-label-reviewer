import react from "@vitejs/plugin-react";
import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  publicDir: path.resolve(__dirname, "../../browser-demo/public"),
  server: {
    port: 5174,
    host: "127.0.0.1"
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/tests/unit/setup.ts"],
    exclude: ["node_modules/**", "dist/**", "src/tests/e2e/**", "src/tests/accessibility/**"]
  }
});
