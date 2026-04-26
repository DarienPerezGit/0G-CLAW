import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Only run our tests — exclude the openclaw submodule entirely.
    include: ['adapters/**/*.test.ts', 'examples/**/*.test.ts'],
    exclude: ['openclaw/**', 'node_modules/**', 'dist/**'],
  },
});
