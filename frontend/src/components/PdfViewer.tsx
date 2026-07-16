import { useEffect, useRef, useState } from 'react';
import { Spin } from 'antd';
import * as pdfjsLib from 'pdfjs-dist';

// 设置 worker 路径（从 node_modules 加载）
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.js',
  import.meta.url
).href;

interface PdfViewerProps {
  pdfUrl: string;
}

export default function PdfViewer({ pdfUrl }: PdfViewerProps) {
  const canvasContainerRef = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [progress, setProgress] = useState('');

  useEffect(() => {
    let cancelled = false;
    const canvasNodes: HTMLCanvasElement[] = [];

    async function init() {
      try {
        if (cancelled) return;

        setLoading(true);
        setError('');

        const resp = await fetch(pdfUrl);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const arrayBuffer = await resp.arrayBuffer();
        if (cancelled) return;

        const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
        if (cancelled) return;

        const total = pdf.numPages;
        setProgress(`共 ${total} 页，正在渲染...`);

        // 计算缩放
        const containerWidth = canvasContainerRef.current?.clientWidth || 800;
        const firstPage = await pdf.getPage(1);
        const vp = firstPage.getViewport({ scale: 1 });
        const scale = Math.min(containerWidth / vp.width, 2);
        firstPage.cleanup();

        const container = canvasContainerRef.current;
        if (!container || cancelled) return;

        // 清空之前残留的画布（保留容器本身）
        container.innerHTML = '';

        // 并发渲染所有页面
        const pageNums = Array.from({ length: total }, (_, i) => i + 1);
        let completed = 0;

        async function renderOne(pageNum: number) {
          if (cancelled) return;
          const page = await pdf.getPage(pageNum);
          const scaledVp = page.getViewport({ scale });

          // 页面包裹 div（模拟纸张效果）
          const wrapper = document.createElement('div');
          wrapper.style.cssText = `
            margin: 8px auto;
            max-width: 100%;
            box-shadow: 0 2px 12px rgba(0,0,0,0.3);
            background: white;
          `;

          const canvas = document.createElement('canvas');
          canvas.width = scaledVp.width;
          canvas.height = scaledVp.height;
          canvas.style.cssText = 'display: block; width: 100%; height: auto;';
          wrapper.appendChild(canvas);
          container.appendChild(wrapper);
          canvasNodes.push(canvas);

          const ctx = canvas.getContext('2d');
          if (!ctx) return;

          await page.render({ canvasContext: ctx, viewport: scaledVp }).promise;
          page.cleanup();

          completed++;
          if (!cancelled) {
            setProgress(`共 ${total} 页，已渲染 ${completed}/${total}`);
          }
        }

        // 并发渲染所有页面（控制并发数 3）
        const concurrency = 3;
        for (let i = 0; i < pageNums.length; i += concurrency) {
          const batch = pageNums.slice(i, i + concurrency);
          await Promise.all(batch.map(renderOne));
        }

        if (!cancelled) {
          setLoading(false);
          setProgress('');
        }
      } catch (e: any) {
        if (!cancelled) {
          console.error('PdfViewer 渲染失败:', e);
          setError(e.message || 'PDF 渲染失败');
          setLoading(false);
        }
      }
    }

    init();

    return () => {
      cancelled = true;
      canvasNodes.forEach((c) => {
        const ctx = c.getContext('2d');
        if (ctx) ctx.clearRect(0, 0, c.width, c.height);
      });
    };
  }, [pdfUrl]);

  if (error) {
    return (
      <div style={{ textAlign: 'center', padding: 40, color: '#ff4d4f' }}>
        <p>❌ {error}</p>
      </div>
    );
  }

  return (
    <div
      style={{
        background: '#525659',
        minHeight: 300,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        position: 'relative',
      }}
    >
      {loading && (
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 10,
            background: 'rgba(82,86,89,0.9)',
          }}
        >
          <Spin size="large" />
          {progress && (
            <p style={{ color: '#ccc', marginTop: 12, fontSize: 13 }}>{progress}</p>
          )}
        </div>
      )}
      <div
        ref={canvasContainerRef}
        style={{
          width: '100%',
          maxWidth: 900,
          padding: '8px 0',
        }}
      />
    </div>
  );
}
