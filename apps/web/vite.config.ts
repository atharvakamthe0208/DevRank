import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  resolve: { preserveSymlinks: true },
  // This workspace contract is actively developed alongside the web app. Avoid serving a
  // stale prebundled copy after its timestamp schema changes; load its development export.
  optimizeDeps: { exclude: ['@devrank/contracts'] },
  test: { environment: 'node', globals: true },
});
