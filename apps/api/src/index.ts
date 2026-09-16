import { createHealthServer } from './server.js';
import { checkDatabase, disconnectDatabase, getDatabase } from './database.js';
import { authOptions, createAuthHandler } from './auth.js';

const server = createHealthServer(checkDatabase, createAuthHandler(getDatabase, authOptions()));
server.on('error', (error: Error) => {
  console.error('AkGebeya API could not start:', error.message);
  process.exitCode = 1;
});
server.listen(3001, '127.0.0.1', () => {
  console.log('AkGebeya API: http://127.0.0.1:3001');
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => server.close(() => {
    void disconnectDatabase().catch(() => { process.exitCode = 1; });
  }));
}
