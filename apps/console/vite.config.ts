import react from "@vitejs/plugin-react";
import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  base: process.env.VITE_BASE_PATH || "/",
  publicDir: path.resolve(__dirname, "../../browser-demo/public"),
  resolve: {
    alias: {
      "@browser-demo": path.resolve(__dirname, "../../browser-demo/src")
    }
  },
  server: {
    port: 5174,
    host: "127.0.0.1",
    fs: {
      allow: [path.resolve(__dirname, "../..")]
    }
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/tests/unit/setup.ts"],
    exclude: ["node_modules/**", "dist/**", "src/tests/e2e/**", "src/tests/accessibility/**"]
  }
});
