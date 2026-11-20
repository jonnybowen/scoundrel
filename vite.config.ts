import { defineConfig } from 'vite';

// Static site: relative base so the build can be hosted from any path (GitHub Pages, itch.io, etc.).
export default defineConfig({
  base: './',
  build: {
    target: 'es2022',
    assetsInlineLimit: 0, // keep pixel-art sprites as files; never base64 them into JS
    sourcemap: true,
  },
  server: { port: 5173 },
  preview: { port: 4173 },
});
