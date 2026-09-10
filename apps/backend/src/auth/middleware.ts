import type { Request, RequestHandler } from 'express';
import { z } from 'zod';
import { UserRole } from '../generated/prisma/enums.js';
import { HttpError } from '../errors.js';
import type { AuthService } from './service.js';

const authorizationSchema = z.string().max(4103).regex(/^Bearer [A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/i)
  .transform((value) => value.slice(7));

export function authenticatedContext(request: Request) {
  if (!request.auth) throw new HttpError('UNAUTHORIZED');
  return request.auth;
}

export function authenticate(service: AuthService): RequestHandler {
  return async (request, _response, next) => {
    let headerCount = 0;
    for (let index = 0; index < request.rawHeaders.length; index += 2) {
      if (request.rawHeaders[index]?.toLowerCase() === 'authorization') headerCount++;
    }
    const result = authorizationSchema.safeParse(request.headers.authorization);
    if (headerCount !== 1 || !result.success) throw new HttpError('UNAUTHORIZED');
    request.auth = await service.authenticate(result.data);
    next();
  };
}

export function requireRoles(...roles: UserRole[]): RequestHandler {
  const allowed = new Set(z.array(z.enum(UserRole)).min(1).parse(roles));
  return (request, _response, next) => {
    const context = authenticatedContext(request);
    if (!allowed.has(context.user.role)) throw new HttpError('FORBIDDEN');
    next();
  };
}

const emptyRequest = z.object({
  params: z.object({}).strict(), query: z.object({}).strict(), body: z.object({}).strict().optional(),
});
export const validateEmptyRequest: RequestHandler = (request, _response, next) => {
  if (!emptyRequest.safeParse({ params: request.params, query: request.query, body: request.body }).success) {
    throw new HttpError('BAD_REQUEST');
  }
  next();
};
