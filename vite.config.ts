import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  base: '/MAMLLoops/', // GitHub Pages base path - must match repo name exactly
  server: {
    host: true,
    port: 5173,
  },
})
