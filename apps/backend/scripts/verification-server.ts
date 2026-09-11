import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';

// Shared by manual verifiers; child diagnostics and credentials stay private.
export async function withBuiltServer(environment: NodeJS.ProcessEnv, run: (base: string) => Promise<void>) {
  const reservation = createServer();
  reservation.listen(0, '127.0.0.1');
  await once(reservation, 'listening');
  const address = reservation.address();
  assert.ok(address && typeof address !== 'string');
  const port = address.port;
  await new Promise<void>((resolve, reject) => reservation.close(error => error ? reject(error) : resolve()));
  const server = spawn(process.execPath, [fileURLToPath(new URL('../dist/server.js', import.meta.url))], {
    cwd: fileURLToPath(new URL('..', import.meta.url)), windowsHide: true,
    env: { ...process.env, ...environment, HOST: '127.0.0.1', PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  const closed = new Promise<void>(resolve => server.once('close', () => resolve()));
  try {
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Built server startup timed out')), 10_000);
      const finish = (error?: Error) => { clearTimeout(timeout); error ? reject(error) : resolve(); };
      server.once('error', () => finish(new Error('Could not start built server')));
      server.once('exit', () => finish(new Error('Built server exited before verification')));
      server.stdout?.on('data', chunk => { if (String(chunk).includes('Backend listening')) finish(); });
      server.stderr?.on('data', () => {});
    });
    await run('http://127.0.0.1:' + port + '/api/v1/auth');
  } finally { server.kill(); await closed; }
}
