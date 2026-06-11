import { defineConfig } from "orval";

export default defineConfig({
  ttbApi: {
    input: {
      target: process.env.TTB_OPENAPI_URL || "openapi.generated.json"
    },
    output: {
      target: "src/api/generated/ttbApi.ts",
      client: "fetch",
      clean: true,
      override: {
        mutator: {
          path: "src/api/client.ts",
          name: "apiFetch"
        }
      }
    }
  }
});
