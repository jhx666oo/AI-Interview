// 全局中间件：代理 /api/* 到 Worker
const WORKER_URL = 'https://ai-interview-api.huangweigem.workers.dev';

export async function onRequest(context: { request: Request; env: any; next: () => Promise<Response> }) {
  const url = new URL(context.request.url);

  // 处理 CORS 预检
  if (context.request.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': '*',
      },
    });
  }

  // 只代理 /api/ 开头的请求
  if (url.pathname.startsWith('/api/')) {
    const workerUrl = WORKER_URL + url.pathname + url.search;
    try {
      // 正确传递 body：先读取出文本，再重建请求
      let body: BodyInit | null = null;
      if (context.request.method !== 'GET' && context.request.method !== 'HEAD') {
        body = await context.request.text();
      }
      const resp = await fetch(workerUrl, {
        method: context.request.method,
        headers: context.request.headers,
        body,
        redirect: 'manual',
      });
      const newHeaders = new Headers(resp.headers);
      newHeaders.set('Access-Control-Allow-Origin', '*');
      return new Response(resp.body, { status: resp.status, headers: newHeaders });
    } catch (e: any) {
      return new Response(JSON.stringify({ detail: 'API proxy error: ' + e.message }), {
        status: 502,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }
  }

  // 非 API 请求正常处理（走 SPA）
  return context.next();
}
