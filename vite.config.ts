import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  // GitHub Pages serves this app from a /ProjectManagement/ subpath; Vercel
  // (and any other host serving from the domain root) needs base '/'.
  base: process.env.VERCEL ? '/' : '/ProjectManagement/',
  plugins: [react()],
})
