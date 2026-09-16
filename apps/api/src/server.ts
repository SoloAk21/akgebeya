import { createServer } from 'node:http';

export function createHealthServer() {
  return createServer((request, response) => {
    response.setHeader('Content-Type', 'application/json; charset=utf-8');
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    const path = request.url?.split('?')[0];

    if (path !== '/api/health') {
      response.writeHead(404);
      response.end(JSON.stringify({ error: 'NOT_FOUND' }));
      return;
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.setHeader('Allow', 'GET, HEAD');
      response.writeHead(405);
      response.end(JSON.stringify({ error: 'METHOD_NOT_ALLOWED' }));
      return;
    }

    response.writeHead(200);
    response.end(request.method === 'HEAD' ? undefined : JSON.stringify({
      status: 'ok', service: 'akgebeya-api', timestamp: new Date().toISOString(),
    }));
  });
}
