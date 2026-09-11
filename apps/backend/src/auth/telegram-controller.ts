import type { RequestHandler } from 'express';
import { z } from 'zod';
import { HttpError } from '../errors.js';
import type { TelegramAuthService } from './telegram-service.js';

const requestSchema = z.object({
  body: z.object({ initData: z.string().min(1).max(12_000) }).strict(),
  query: z.object({}).strict(),
  params: z.object({}).strict(),
});

export function telegramController(service: TelegramAuthService): RequestHandler {
  return async (request, response) => {
    const parsed = requestSchema.safeParse({ body: request.body, query: request.query, params: request.params });
    if (!request.is('application/json') || !parsed.success) throw new HttpError('BAD_REQUEST');
    const session = await service.login(parsed.data.body.initData);
    response.status(200).json(session);
  };
}
