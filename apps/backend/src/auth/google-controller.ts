import type { RequestHandler } from 'express';
import { z } from 'zod';
import { HttpError } from '../errors.js';
import type { GoogleAuthService } from './google-service.js';

const requestSchema = z.object({
  body: z.object({ idToken: z.string().min(1).max(12_000) }).strict(),
  query: z.object({}).strict(), params: z.object({}).strict(),
});
export function googleController(service: GoogleAuthService): RequestHandler {
  return async (request, response) => {
    const input = requestSchema.safeParse({ body: request.body, query: request.query, params: request.params });
    if (!request.is('application/json') || !input.success) throw new HttpError('BAD_REQUEST');
    response.status(200).json(await service.login(input.data.body.idToken));
  };
}
