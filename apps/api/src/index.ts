import { createHealthServer } from './server.js';

const server = createHealthServer();
server.on('error', (error: Error) => {
  console.error('AkGebeya API could not start:', error.message);
  process.exitCode = 1;
});
server.listen(3001, '127.0.0.1', () => {
  console.log('AkGebeya API: http://127.0.0.1:3001');
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => server.close());
}
