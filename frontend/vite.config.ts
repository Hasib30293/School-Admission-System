import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const backend = process.env.BACKEND_URL || 'http://localhost:8080';
const proxy = {
  '/classes': backend,
  '/holds': backend,
  '/me': backend,
  '/health': backend,
  '/swagger': backend,
};

export default defineConfig({
  plugins: [react()],
  server: { proxy },
  preview: { proxy },
});
