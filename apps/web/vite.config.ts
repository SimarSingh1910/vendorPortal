import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      // Resolve the shared workspace package to its TypeScript source. Vite
      // compiles TS directly, sidestepping the pnpm-symlink + CommonJS interop
      // problem that breaks named imports from the package's built dist.
      // (tsc still type-checks against the package's published dist types.)
      '@portal/shared': path.resolve(__dirname, '../../packages/shared/src/index.ts'),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
  },
});
