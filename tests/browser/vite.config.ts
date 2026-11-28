import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';

export default defineConfig({
  root: fileURLToPath(new URL('../..', import.meta.url)),
  // Prebundle the game and loading-page dependencies so discovering React or
  // the CommonJS debugger cannot reload a running test.
  optimizeDeps: {
    entries: ['../../src/main.ts', '../../src/bootstrap.tsx'].map(path =>
      fileURLToPath(new URL(path, import.meta.url)),
    ),
    include: ['three', 'cannon-es', 'fflate', '@dontstarve-web/animation > fflate', 'cannon-es-debugger'],
  },
  server: {
    // Workspace edits must not reload a test while it is running.
    hmr: false,
    host: '127.0.0.1',
    strictPort: true,
  },
});
