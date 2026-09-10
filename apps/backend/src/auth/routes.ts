import { Router } from 'express';
import type { AuthService } from './service.js';
import { authController } from './controller.js';
import { authenticate, validateEmptyRequest } from './middleware.js';

export function authRouter(service: AuthService) {
  const router = Router();
  const controller = authController(service);
  router.use((_request, response, next) => {
    response.set('Cache-Control', 'no-store');
    response.vary('Authorization');
    next();
  });
  router.get('/me', authenticate(service), validateEmptyRequest, controller.me);
  router.post('/logout', authenticate(service), validateEmptyRequest, controller.logout);
  return router;
}
