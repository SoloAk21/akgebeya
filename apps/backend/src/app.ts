import {paymentWebhookRouter} from './payments/webhook-routes.js';
import type {PaymentWebhookService} from './payments/webhook-service.js';
import { listingRouter } from './listings/routes.js';
import type { ListingService } from './listings/service.js';
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

export function createApp(config: AppConfig, auth: AuthService, telegram?: TelegramAuthService, phone?: PhoneOtpService, google?: GoogleAuthService, provider?: ProviderService, listings?: ListingService, webhook?: PaymentWebhookService) {
  const app = express();
  app.set('env', config.nodeEnv);
  app.disable('x-powered-by');
  app.use(helmet());
  app.use(cors({ origin: [...config.corsOrigins], methods: ['GET', 'HEAD', 'POST', 'PATCH', 'DELETE'], allowedHeaders: ['Authorization', 'Content-Type', 'If-Match'], exposedHeaders: ['ETag'] }));
  app.use(express.json({ limit: '16kb' }));

  app.get(`${config.apiPrefix}/health`, (_request, response) => {
    response.status(200).json({ status: 'ok' });
  });

  app.use(`${config.apiPrefix}/auth`, authRouter(auth, telegram, phone, google));
  if (provider) app.use(config.apiPrefix, providerRouter(auth, provider));
  if (listings && provider) app.use(config.apiPrefix + '/listings', listingRouter(auth,provider,listings));
  if (webhook) app.use(config.apiPrefix, paymentWebhookRouter(webhook));
  app.use(notFound);
  app.use(errorHandler);
  return app;
}
