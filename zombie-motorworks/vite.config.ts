import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 4096,
    rollupOptions: {
      output: {
        // Three and Rapier are the bulk of the bundle and change only when we
        // bump them. Splitting them out lets a returning player reuse both from
        // cache when only game code shipped, and lets the browser fetch the
        // three chunks in parallel on a cold load.
        manualChunks(id: string) {
          if (id.includes('node_modules/@dimforge/rapier3d-compat')) {
            return 'rapier';
          }
          if (id.includes('node_modules/three')) return 'three';
          return undefined;
        },
      },
    },
  },
});
