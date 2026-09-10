import { createHash, randomBytes } from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';
import { z } from 'zod';
import type { AuthConfig } from '../config.js';
import { HttpError } from '../errors.js';

const claimsSchema = z.object({
  sub: z.string().uuid(), jti: z.string().regex(/^[0-9a-f]{64}$/),
  iss: z.string(), aud: z.string(),
  iat: z.number().int().nonnegative(), exp: z.number().int().positive(),
}).strict();
const tokenSchema = z.string().max(4096).regex(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);

export function hashSessionIdentifier(identifier: string) {
  return createHash('sha256').update(identifier).digest('hex');
}

export class SessionTokens {
  constructor(private readonly config: AuthConfig) {}

  async issue(userId: string, now: Date) {
    const identifier = randomBytes(32).toString('hex');
    const issuedAt = Math.floor(now.getTime() / 1000);
    const expires = issuedAt + this.config.sessionTtlSeconds;
    const token = await new SignJWT({})
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setIssuer(this.config.issuer).setAudience(this.config.audience)
      .setSubject(userId).setJti(identifier).setIssuedAt(issuedAt).setExpirationTime(expires)
      .sign(this.config.secret);
    return { token, tokenHash: hashSessionIdentifier(identifier), expiresAt: new Date(expires * 1000) };
  }

  async verify(token: string, now: Date) {
    try {
      const validated = tokenSchema.parse(token);
      const { payload } = await jwtVerify(validated, this.config.secret, {
        algorithms: ['HS256'], typ: 'JWT', issuer: this.config.issuer, audience: this.config.audience,
        requiredClaims: ['sub', 'jti', 'iat', 'exp'], maxTokenAge: this.config.sessionTtlSeconds,
        currentDate: now, clockTolerance: 0,
      });
      const claims = claimsSchema.parse(payload);
      if (claims.exp <= claims.iat || claims.exp - claims.iat > this.config.sessionTtlSeconds) throw new Error('Invalid lifetime');
      return { userId: claims.sub, tokenHash: hashSessionIdentifier(claims.jti), expiresAt: claims.exp * 1000 };
    } catch {
      // Never expose or log a supplied JWT or verifier error.
      throw new HttpError('UNAUTHORIZED');
    }
  }
}
