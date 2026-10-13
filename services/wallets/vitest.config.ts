import { defineConfig } from 'vitest/config';

// Resolve workspace packages to their TypeScript sources so tests never depend on a prior build.
const conditions = ['@plug360/source', 'module', 'node', 'development|production'];

export default defineConfig({
  resolve: { conditions },
  ssr: { resolve: { conditions } },
  test: { testTimeout: 60_000, hookTimeout: 60_000 },
});
