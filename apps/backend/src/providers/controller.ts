import type { RequestHandler } from 'express';
import { z } from 'zod';
import { authenticatedContext } from '../auth/middleware.js';
import { HttpError } from '../errors.js';
import { decisionInput, providerInput, type ProviderService } from './service.js';

const empty = z.object({}).strict();
const requestInput = (body: z.ZodType, params: z.ZodType = empty) => z.object({ body, params, query: empty });
function validate(request: Parameters<RequestHandler>[0], schema: z.ZodType, json = false) {
  const hasBody = request.body !== undefined || request.headers['transfer-encoding'] !== undefined || Number(request.headers['content-length'] ?? 0) > 0;
  if (((json || hasBody) && !request.is('application/json')) || !schema.safeParse({ body: request.body, params: request.params, query: request.query }).success) throw new HttpError('BAD_REQUEST');
}
export function providerController(service: ProviderService) {
  const create: RequestHandler = async (req, res) => {
    validate(req, requestInput(providerInput), true);
    res.status(201).json({ provider: await service.create(authenticatedContext(req), req.body) });
  };
  const me: RequestHandler = async (req, res) => {
    validate(req, requestInput(empty.optional()));
    res.json({ provider: await service.me(authenticatedContext(req)) });
  };
  const submit: RequestHandler = async (req, res) => {
    validate(req, requestInput(empty.optional()));
    res.status(201).json({ verification: await service.submit(authenticatedContext(req)) });
  };
  const status: RequestHandler = async (req, res) => {
    validate(req, requestInput(empty.optional()));
    res.json({ verification: (await service.me(authenticatedContext(req))).verification });
  };
  const decide = (approve: boolean): RequestHandler => async (req, res) => {
    validate(req, requestInput(decisionInput, z.object({ providerId: z.string().uuid() }).strict()), true);
    res.json({ verification: await service.decide(authenticatedContext(req), String(req.params.providerId), req.body, approve) });
  };
  return { create, me, submit, status, approve: decide(true), reject: decide(false) };
}
