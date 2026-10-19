import { defineConfig } from 'vite';

// three.js alone is ~600 kB; one chunk is fine for a game.
export default defineConfig({ build: { target: 'es2022', chunkSizeWarningLimit: 1000 } });
