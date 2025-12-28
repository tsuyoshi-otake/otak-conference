import path from 'path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: 'public',
  publicDir: false,
  plugins: [react()],
  define: {
    'process.env.NODE_ENV': JSON.stringify('development'),
    'process.env.CLOUDFLARE_WORKER_DOMAIN': JSON.stringify(
      process.env.CLOUDFLARE_WORKER_DOMAIN ||
        'otak-conference-worker.systemexe-research-and-development.workers.dev'
    ),
    'process.env.GEMINI_API_KEY': JSON.stringify(process.env.GEMINI_API_KEY || ''),
    'process.env.REACT_APP_COMMIT_HASH': JSON.stringify(process.env.REACT_APP_COMMIT_HASH || 'dev'),
  },
  resolve: {
    alias: {
      '/src': path.resolve(__dirname, 'src'),
    },
  },
  server: {
    port: 3000,
    strictPort: true,
    fs: {
      allow: [path.resolve(__dirname)],
    },
  },
});
