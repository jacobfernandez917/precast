import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.spec.ts'],
  },
  resolve: {
    alias: {
      '@precast/shared': fileURLToPath(
        new URL('../../packages/shared/src/index.ts', import.meta.url),
      ),
    },
  },
});
