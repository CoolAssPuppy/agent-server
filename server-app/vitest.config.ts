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
      exclude: ['src/**/*.test.ts', 'src/cli.ts'],
      // Ratcheting gate: autoUpdate raises the floor as coverage improves and
      // CI fails on any regression. Matches the web package's policy.
      thresholds: {
        autoUpdate: true,
        lines: 75.24,
        functions: 73.32,
        branches: 68.32,
        statements: 74.28,
      },
    },
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
});
