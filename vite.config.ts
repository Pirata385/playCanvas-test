import { defineConfig } from 'vitest/config';

export default defineConfig({
  base: './',
  worker: { format: 'es' },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 4000,
    rollupOptions: {
      output: {
        manualChunks: {
          playcanvas: ['playcanvas'],
          rapier: ['@dimforge/rapier3d-compat']
        }
      }
    }
  },
  optimizeDeps: { exclude: ['@dimforge/rapier3d-compat'] },
  test: { environment: 'node', include: ['tests/**/*.test.ts'] }
});
