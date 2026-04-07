import { defineConfig } from 'vite';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Dev: / langsung ke store. Admin: /admin.html */
function rootToStorePlugin() {
  return {
    name: 'codex-root-to-store',
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        const url = req.url || '';
        if (url === '/' || url.startsWith('/?')) {
          req.url = url === '/' ? '/store.html' : '/store.html' + url.slice(1);
        }
        next();
      });
    },
  };
}

export default defineConfig({
  root: __dirname,
  publicDir: false,
  plugins: [rootToStorePlugin()],
  server: {
    open: '/store.html',
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        index: resolve(__dirname, 'index.html'),
        admin: resolve(__dirname, 'admin.html'),
        store: resolve(__dirname, 'store.html'),
        auth: resolve(__dirname, 'auth.html'),
        profile: resolve(__dirname, 'profile.html'),
      },
    },
  },
});
