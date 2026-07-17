import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
      '/uploads': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          // 将 antd + react 全家桶拆为独立 vendor chunk（长期缓存）
          vendor: [
            'react',
            'react-dom',
            'react-router-dom',
            'antd',
            '@ant-design/icons',
            'dayjs',
          ],
          // recharts 单独拆开（体积较大且变动较少）
          charts: ['recharts'],
          // pdf.js 独立 chunk（仅在预览简历时加载）
          pdf: ['pdfjs-dist'],
        },
      },
    },
  },
})
