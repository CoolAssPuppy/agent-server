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
      // Coverage floor. Set a couple points below the current baseline
      // (~75% lines / 68% branches) so trivial CI-vs-local v8 variance can't
      // fail the build; raise it as coverage climbs. autoUpdate is off because
      // pinning the floor to the exact local number is brittle across runners.
      thresholds: {
        lines: 74,
        functions: 72,
        branches: 67,
        statements: 73,
      },
    },
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
});
