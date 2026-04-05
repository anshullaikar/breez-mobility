import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    host: '0.0.0.0',
    proxy: {
      '/auth': 'http://app:3000',
      '/rides': 'http://app:3000',
      '/admin': 'http://app:3000',
      '/drivers': 'http://app:3000',
      '/events': 'http://app:3000',
      '/health': 'http://app:3000',
    },
  },
})
