import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Builds into ../dist, which portal_api.py / portal_server.py serve at http://<host>:8000/.
// `npm run dev` serves the app on :5173 and forwards the data and API calls to the running portal on :8000.
export default defineConfig({
  plugins: [react()],
  base: '/',
  build: { outDir: '../dist', emptyOutDir: true, chunkSizeWarningLimit: 2000 },
  server: { proxy: { '/api': 'http://127.0.0.1:8000', '/lib': 'http://127.0.0.1:8000' } },
});
