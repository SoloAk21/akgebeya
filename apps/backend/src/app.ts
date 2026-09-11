import { providerRouter } from './providers/routes.js';
import type { ProviderService } from './providers/service.js';
import type { GoogleAuthService } from './auth/google-service.js';
import type { TelegramAuthService } from './auth/telegram-service.js';
import { authRouter } from './auth/routes.js';
import type { AuthService } from './auth/service.js';
import type { PhoneOtpService } from './auth/phone-service.js';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import type { AppConfig } from './config.js';
import { errorHandler, notFound } from './errors.js';

export function createApp(config: AppConfig, auth: AuthService, telegram?: TelegramAuthService, phone?: PhoneOtpService, google?: GoogleAuthService, provider?: ProviderService) {
  const app = express();
  app.set('env', config.nodeEnv);
  app.disable('x-powered-by');
  app.use(helmet());
  app.use(cors({ origin: [...config.corsOrigins], methods: ['GET', 'HEAD', 'POST'], allowedHeaders: ['Authorization', 'Content-Type'] }));
  app.use(express.json({ limit: '16kb' }));

  app.get(`${config.apiPrefix}/health`, (_request, response) => {
    response.status(200).json({ status: 'ok' });
  });

  app.use(`${config.apiPrefix}/auth`, authRouter(auth, telegram, phone, google));
  if (provider) app.use(config.apiPrefix, providerRouter(auth, provider));
  app.use(notFound);
  app.use(errorHandler);
  return app;
}
