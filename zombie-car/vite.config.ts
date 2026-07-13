import { defineConfig } from "vite";

// Relative base so the production build works from any static path
// (required for YouTube Playables-style hosting).
export default defineConfig({
  base: "./",
  build: {
    target: "es2022",
    chunkSizeWarningLimit: 4096,
  },
});
