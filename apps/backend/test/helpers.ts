import { once } from 'node:events';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import type express from 'express';

export async function withServer(app: ReturnType<typeof express>, run: (base: string) => Promise<void>) {
  const server = createServer(app);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try { await run(`http://127.0.0.1:${(server.address() as AddressInfo).port}`); }
  finally {
    await new Promise<void>((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve());
      server.closeAllConnections();
    });
  }
}
