import { defineConfig } from 'vite';
import resumePrerender from './vite-plugin-resume.js';

export default defineConfig({
  base: '/',
  plugins: [resumePrerender()],
  build: {
    outDir: 'dist',
    assetsInlineLimit: 0,
    target: 'es2020',
  },
  server: {
    port: 5173,
    open: true,
  },
});
