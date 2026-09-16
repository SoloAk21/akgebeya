import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

export function createHealthServer(readiness?: () => Promise<void>, auth?: (request: IncomingMessage, response: ServerResponse) => Promise<void>) {
  return createServer((request, response) => {
    response.setHeader('Content-Type', 'application/json; charset=utf-8');
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    const path = request.url?.split('?')[0];
    if ((path?.startsWith('/api/auth/') || path === '/api/profile') && auth) {
      void auth(request, response);
      return;
    }

    if (path !== '/api/health' && path !== '/api/ready') {
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

    if (path === '/api/ready') {
      const check = readiness ? Promise.resolve().then(readiness) : Promise.reject(new Error('Not configured'));
      void check.then(() => {
        response.writeHead(200);
        response.end(request.method === 'HEAD' ? undefined : JSON.stringify({ status: 'ok', database: 'ready' }));
      }).catch(() => {
        response.writeHead(503);
        response.end(request.method === 'HEAD' ? undefined : JSON.stringify({ status: 'unavailable', database: 'unavailable' }));
      });
      return;
    }

    response.writeHead(200);
    response.end(request.method === 'HEAD' ? undefined : JSON.stringify({
      status: 'ok', service: 'akgebeya-api', timestamp: new Date().toISOString(),
    }));
  });
}
