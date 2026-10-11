import { defineConfig } from 'vitest/config';

// Preserve file paths rather than calling fs.realpath during Vite module resolution.
// This also keeps test runs working in Windows environments where realpath is restricted.
export default defineConfig({
  resolve: { preserveSymlinks: true },
  test: { environment: 'node', globals: true },
});
