import type { RequestHandler } from 'express';
import { z } from 'zod';
import { HttpError } from '../errors.js';
import { phoneSchema, otpSchema } from './phone-input.js';
import type { PhoneOtpService } from './phone-service.js';

const empty = z.object({}).strict();
const requestSchema = z.object({ query: empty, params: empty, body: z.object({ phone: phoneSchema }).strict() });
const verifySchema = z.object({ query: empty, params: empty,
  body: z.object({ phone: phoneSchema, challengeId: z.string().uuid(), otp: otpSchema }).strict() });

export function phoneController(service: PhoneOtpService) {
  const requestOtp: RequestHandler = async (request, response) => {
    const result = requestSchema.safeParse({ query: request.query, params: request.params, body: request.body });
    if (!request.is('application/json') || !result.success) throw new HttpError('BAD_REQUEST');
    response.status(200).json(await service.request(result.data.body.phone));
  };
  const verifyOtp: RequestHandler = async (request, response) => {
    const result = verifySchema.safeParse({ query: request.query, params: request.params, body: request.body });
    if (!request.is('application/json') || !result.success) throw new HttpError('BAD_REQUEST');
    response.status(200).json(await service.verify(result.data.body));
  };
  return { requestOtp, verifyOtp };
}
