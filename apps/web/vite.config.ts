
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const workspaceEnv = loadEnv(mode, process.cwd(), '');
  const apiTarget = workspaceEnv.VITE_DEV_API_PROXY_TARGET || 'http://127.0.0.1:3000';
  return {
    plugins: [react()],
    // This workspace contract is actively developed alongside the web app. Avoid serving a
    // stale prebundled copy after its timestamp schema changes; load its development export.
    optimizeDeps: { exclude: ['@devrank/contracts'] },
    server: {
      host: '0.0.0.0',
      proxy: { '/api': { target: apiTarget, changeOrigin: false } },
    },
    test: { environment: 'node', globals: true },
  };
});
