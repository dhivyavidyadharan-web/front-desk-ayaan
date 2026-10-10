import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    include: ['tests/**/*.test.ts'],
    // Integration tests hit the Neon test branch; run them with `npm run test:integration`.
    exclude: process.env.INTEGRATION ? ['node_modules/**'] : ['tests/integration/**', 'node_modules/**'],
    testTimeout: process.env.INTEGRATION ? 60_000 : 5_000,
    // Integration files share one test database; run them one at a time.
    fileParallelism: !process.env.INTEGRATION,
  },
});
