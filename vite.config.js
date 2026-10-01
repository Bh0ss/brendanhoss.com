import { defineConfig } from 'vite';
import resumePrerender from './vite-plugin-resume.js';

export default defineConfig({
  base: '/',
  plugins: [resumePrerender()],
  build: {
    outDir: 'dist',
    assetsInlineLimit: 0,
    target: 'es2020',
    // three.js alone is ~585 kB minified (its own chunk, off the /resume landing): don't warn on it
    chunkSizeWarningLimit: 640,
  },
  server: {
    port: 5173,
    open: true,
  },
});
