import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import type { AppConfig } from './config.js';
import { errorHandler, notFound } from './errors.js';

export function createApp(config: AppConfig) {
  const app = express();
  app.set('env', config.nodeEnv);
  app.disable('x-powered-by');
  app.use(helmet());
  app.use(cors({ origin: [...config.corsOrigins], methods: ['GET', 'HEAD'] }));
  app.use(express.json({ limit: '16kb' }));

  app.get(`${config.apiPrefix}/health`, (_request, response) => {
    response.status(200).json({ status: 'ok' });
  });

  app.use(notFound);
  app.use(errorHandler);
  return app;
}
