import type { RequestHandler } from 'express';
import type { AuthService } from './service.js';
import { authenticatedContext } from './middleware.js';

export function authController(service: AuthService) {
  const me: RequestHandler = (request, response) => {
    response.status(200).json({ user: authenticatedContext(request).user });
  };
  const logout: RequestHandler = async (request, response) => {
    await service.logout(authenticatedContext(request));
    response.status(200).json({ status: 'ok' });
  };
  return { me, logout };
}
