import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';

export default defineConfig({
  publicDir: fileURLToPath(new URL('../../public', import.meta.url)),
  // Full-game interaction tests import scene.ts; prebundle its CommonJS debugger
  // before opening a page so dependency discovery cannot reload the test mid-action.
  optimizeDeps: { include: ['three', 'cannon-es', '@three-roaming/animation > fflate', 'cannon-es-debugger'] },
  server: {
    host: '127.0.0.1',
    port: 4175,
    strictPort: true,
  },
});
