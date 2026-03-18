import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  server: {
    proxy: {
      '/admin': 'http://127.0.0.1:8000',
      '/webhook': 'http://127.0.0.1:8000',
    },
  },
  // base 设为 /console/，让构建产物中所有资源引用路径带上前缀
  // index.html 里 <script src="/console/assets/..."> 才能命中后端挂载路径
  base: '/console/',
  build: {
    outDir: path.resolve(__dirname, '../app/static/console'),
    emptyOutDir: true,
  },
})
