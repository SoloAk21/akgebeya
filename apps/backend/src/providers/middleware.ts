import type { RequestHandler } from 'express';
import { z } from 'zod';
import { ProviderRole } from '../generated/prisma/enums.js';
import { authenticatedContext } from '../auth/middleware.js';
import type { ProviderService } from './service.js';

// Follow authenticate(). Resolve role, ownership and current approval from the database.
export function requireVerifiedProvider(service: ProviderService, ...roles: ProviderRole[]): RequestHandler {
  const allowed = z.array(z.enum(ProviderRole)).min(1).parse(roles);
  return async (request, _response, next) => {
    await service.requireVerified(authenticatedContext(request), allowed);
    next();
  };
}
