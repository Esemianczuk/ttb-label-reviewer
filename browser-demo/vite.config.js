import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  test: {
    exclude: ['node_modules/**', 'dist/**', 'tests/e2e/**'],
  },
});
