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
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      output: {
        manualChunks: {
          // React 核心（变动极少，长期缓存）
          'react-core': ['react', 'react-dom', 'react-router-dom', 'dayjs'],
          // Ant Design 全家桶（体积大但变动少，独立缓存）
          antd: ['antd', '@ant-design/icons'],
          // recharts 图表库
          charts: ['recharts'],
          // pdf.js 独立 chunk（仅在预览简历时加载）
          pdf: ['pdfjs-dist'],
          // xlsx 独立 chunk（仅在导出时加载）
          xlsx: ['xlsx'],
        },
      },
    },
  },
})
