import { googleController } from './google-controller.js';
import type { GoogleAuthService } from './google-service.js';
import type { TelegramAuthService } from './telegram-service.js';
import { telegramController } from './telegram-controller.js';
import type { PhoneOtpService } from './phone-service.js';
import { phoneController } from './phone-controller.js';
import { Router } from 'express';
import type { AuthService } from './service.js';
import { authController } from './controller.js';
import { authenticate, validateEmptyRequest } from './middleware.js';

export function authRouter(service: AuthService, telegram?: TelegramAuthService, phone?: PhoneOtpService, google?: GoogleAuthService) {
  const router = Router();
  const controller = authController(service);
  router.use((_request, response, next) => {
    response.set('Cache-Control', 'no-store');
    response.vary('Authorization');
    next();
  });
  if (google) router.post('/google', googleController(google));
  if (telegram) router.post('/telegram', telegramController(telegram));
  if (phone) {
    const controller = phoneController(phone);
    router.post('/phone/request-otp', controller.requestOtp);
    router.post('/phone/verify-otp', controller.verifyOtp);
  }
  router.get('/me', authenticate(service), validateEmptyRequest, controller.me);
  router.post('/logout', authenticate(service), validateEmptyRequest, controller.logout);
  return router;
}
