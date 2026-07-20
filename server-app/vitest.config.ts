import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'json-summary', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts'],
      // Ratcheted from the verified 2026-07-21 baseline after direct CLI and
      // startServer composition coverage: 84.89 lines, 84.68 functions,
      // 77.54 branches, and 83.13 statements.
      // Roughly one point of headroom absorbs minor V8 differences across CI.
      thresholds: {
        lines: 83.5,
        functions: 83.5,
        branches: 76.5,
        statements: 82,
      },
    },
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
});
