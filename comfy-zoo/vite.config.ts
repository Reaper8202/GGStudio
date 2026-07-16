import { defineConfig } from 'vite';

export default defineConfig({
  base: './', // portal builds are served from arbitrary paths (Playables ZIP)
  build: {
    target: 'es2022',
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 1500,
  },
  server: {
    port: 5173,
  },
});
