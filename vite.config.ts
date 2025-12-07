import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  base: '/maml-loops/', // GitHub Pages base path
  server: {
    host: true,
    port: 5173,
  },
})
