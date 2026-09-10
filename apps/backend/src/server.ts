import { createServer } from 'node:http';
import { createApp } from './app.js';
import { loadConfig } from './config.js';

try {
  const config = loadConfig();
  const server = createServer(createApp(config));
  server.listen(config.port, config.host, () => {
    console.log(`Backend listening at http://${config.host}:${config.port}${config.apiPrefix}`);
  });

  server.on('error', (error: NodeJS.ErrnoException) => {
    console.error(`Server failed: ${error.code ?? 'UNKNOWN'}`);
    process.exitCode = 1;
  });

  let shuttingDown = false;
  const shutdown = () => {
    if (shuttingDown) return;
    shuttingDown = true;
    const timeout = setTimeout(() => {
      console.error('Server shutdown timed out');
      process.exit(1);
    }, 10_000);
    timeout.unref();
    server.close((error) => {
      clearTimeout(timeout);
      if (error) {
        console.error('Server shutdown failed');
        process.exitCode = 1;
      }
    });
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Backend startup failed');
  process.exitCode = 1;
}
