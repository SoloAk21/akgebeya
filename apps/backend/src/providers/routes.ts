import { Router } from 'express';
import { authenticate, requireRoles } from '../auth/middleware.js';
import type { AuthService } from '../auth/service.js';
import type { ProviderService } from './service.js';
import { providerController } from './controller.js';

export function providerRouter(auth: AuthService, service: ProviderService) {
  const router = Router(); const controller = providerController(service);
  router.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); res.vary('Authorization'); next(); });
  const authenticated = authenticate(auth);
  router.post('/providers', authenticated, controller.create);
  router.get('/providers/me', authenticated, controller.me);
  router.post('/providers/me/verification', authenticated, controller.submit);
  router.get('/providers/me/verification', authenticated, controller.status);
  router.post('/admin/providers/:providerId/verification/approve', authenticated, requireRoles('ADMIN'), controller.approve);
  router.post('/admin/providers/:providerId/verification/reject', authenticated, requireRoles('ADMIN'), controller.reject);
  return router;
}
