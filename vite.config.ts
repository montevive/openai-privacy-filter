import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: process.env.BASE_PATH ?? '/',
  worker: { format: 'es' },
  optimizeDeps: { exclude: ['@huggingface/transformers'] },
})
