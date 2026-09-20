import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';

export default defineConfig({
  publicDir: fileURLToPath(new URL('../../public', import.meta.url)),
  server: {
    host: '127.0.0.1',
    port: 4175,
    strictPort: true,
  },
});
