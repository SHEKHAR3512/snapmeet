import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/** `npm run dev`: the playground on a local dev server (localStorage instead of chrome.storage). */
export default defineConfig({
  root: resolve(__dirname, 'src/pages'),
  publicDir: resolve(__dirname, 'public'),
  plugins: [react()],
  server: { open: '/playground.html', fs: { allow: [__dirname] } },
});
