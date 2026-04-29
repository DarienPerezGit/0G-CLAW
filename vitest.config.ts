import { defineConfig } from 'vitest/config';
import { config as loadDotenv } from 'dotenv';

// Load .env into process.env before any test file is evaluated.
// This ensures integration tests that check process.env at module-level see real values.
loadDotenv({ override: true });

export default defineConfig({
  test: {
    // Only run our tests — exclude the openclaw submodule entirely.
    include: ['adapters/**/*.test.ts', 'examples/**/*.test.ts'],
    exclude: ['openclaw/**', 'node_modules/**', 'dist/**'],
  },
});
