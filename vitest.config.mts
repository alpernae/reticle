import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['lib/__tests__/**/*.test.ts'],
  },
  resolve: {
    alias: {
      // The Next.js marker module throws outside the bundler; the modules under
      // test are server code, so an empty stub is enough.
      'server-only': path.resolve(process.cwd(), 'test/stubs/server-only.ts'),
      '@': path.resolve(process.cwd(), '.'),
    },
  },
});
