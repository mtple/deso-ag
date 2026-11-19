import { defineConfig } from 'vitest/config';

// Unit tests only. The CLI tests in test/cli.test.ts call the real networks; run them with `pnpm test:live`.
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    exclude: ['test/cli.test.ts', 'node_modules/**'],
  },
});
