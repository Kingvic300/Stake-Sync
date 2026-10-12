import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Admin runs beside the member app: 5173 is the member app, 5174 is admin.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { port: 5174 },
  preview: { port: 4174 },
})
