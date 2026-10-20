import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';

export default defineConfig({
  publicDir: fileURLToPath(new URL('../../public', import.meta.url)),
  // Prebundle the game and loading-page dependencies so discovering React or
  // the CommonJS debugger cannot reload a running interaction test.
  optimizeDeps: {
    entries: ['../../src/main.ts', '../../src/bootstrap.tsx'].map(path => fileURLToPath(new URL(path, import.meta.url))),
    include: ['three', 'cannon-es', 'fflate', '@dontstarve-web/animation > fflate', 'cannon-es-debugger'],
  },
  server: {
    // Tests exercise page lifecycles explicitly; workspace edits must not reload
    // a long-running save/restore or WebGL assertion in the middle of a step.
    hmr: false,
    host: '127.0.0.1',
    port: 4175,
    strictPort: true,
  },
});
