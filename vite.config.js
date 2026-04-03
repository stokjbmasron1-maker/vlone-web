import { defineConfig } from 'vite';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: __dirname,
  publicDir: false,
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        index: resolve(__dirname, 'index.html'),
        store: resolve(__dirname, 'store.html'),
        auth: resolve(__dirname, 'auth.html'),
        profile: resolve(__dirname, 'profile.html'),
      },
    },
  },
});
