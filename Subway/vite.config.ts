import { defineConfig } from 'vite';

// base './' — portals serve the bundle from arbitrary sub-paths.
export default defineConfig({
  base: './',
  build: {
    outDir: 'dist',
    minify: 'esbuild',
    sourcemap: false,
    // Keep everything in as few files as possible; portals count files too
    // (CrazyGames Basic caps at 1500 files).
    assetsInlineLimit: 8192,
    chunkSizeWarningLimit: 2048,
  },
  server: {
    host: true,
  },
});
