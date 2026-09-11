import { createRemoteJWKSet, jwtVerify, errors, type JWTVerifyGetKey } from 'jose';
import { z } from 'zod';
import type { GoogleConfig } from '../config.js';
import { HttpError } from '../errors.js';

export const googleFailureCategories = [
  'TOKEN_FORMAT_INVALID', 'SIGNATURE_INVALID', 'JWKS_LOOKUP_FAILED', 'ISSUER_INVALID',
  'AUDIENCE_INVALID', 'TOKEN_EXPIRED', 'TOKEN_NOT_YET_VALID', 'EMAIL_MISSING',
  'EMAIL_NOT_VERIFIED', 'SUBJECT_MISSING', 'CLAIMS_INVALID', 'UNKNOWN_VERIFICATION_FAILURE',
] as const;
export type GoogleFailureCategory = typeof googleFailureCategories[number];
// Keep the HTTP contract generic. Only private verification tooling reads category.
// Never retain the original exception, payload, claim values or cause.
export const googleFormatReasons = [
  'EMPTY_INPUT', 'SURROUNDING_QUOTES', 'EMBEDDED_WHITESPACE', 'WRONG_SEGMENT_COUNT',
  'EMPTY_SEGMENT', 'INVALID_BASE64URL_CHARACTERS', 'OTHER_FORMAT_ERROR',
] as const;
export type GoogleFormatReason = typeof googleFormatReasons[number];
export class GoogleVerificationFailure extends HttpError {
  constructor(readonly category: GoogleFailureCategory, readonly formatReason?: GoogleFormatReason) { super('UNAUTHORIZED'); }
}
// Normalize only the boundary; never repair quotes, internal whitespace or token characters.
export function normalizeGoogleCredential(input: string): string {
  const token = input.trim();
  const reject = (reason: GoogleFormatReason): never => { throw new GoogleVerificationFailure('TOKEN_FORMAT_INVALID', reason); };
  if (!token) reject('EMPTY_INPUT');
  if (/^["'\u2018\u2019\u201c\u201d]|["'\u2018\u2019\u201c\u201d]$/.test(token)) reject('SURROUNDING_QUOTES');
  if (/\s/.test(token)) reject('EMBEDDED_WHITESPACE');
  const segments = token.split('.');
  if (segments.length !== 3) reject('WRONG_SEGMENT_COUNT');
  if (segments.some(segment => segment === '')) reject('EMPTY_SEGMENT');
  if (segments.some(segment => !/^[A-Za-z0-9_-]+$/.test(segment))) reject('INVALID_BASE64URL_CHARACTERS');
  if (token.length > 12_000) reject('OTHER_FORMAT_ERROR');
  return token;
}
function categorize(error: unknown): GoogleFailureCategory {
  if (error instanceof GoogleVerificationFailure) return error.category;
  if (error instanceof errors.JWTInvalid || error instanceof errors.JWSInvalid) return 'TOKEN_FORMAT_INVALID';
  if (error instanceof errors.JWSSignatureVerificationFailed || error instanceof errors.JOSEAlgNotAllowed) return 'SIGNATURE_INVALID';
  if (error instanceof errors.JWTExpired) return 'TOKEN_EXPIRED';
  if (error instanceof errors.JWTClaimValidationFailed) {
    switch (error.claim) {
      case 'iss': return 'ISSUER_INVALID';
      case 'aud': return 'AUDIENCE_INVALID';
      case 'email': return error.reason === 'missing' ? 'EMAIL_MISSING' : 'CLAIMS_INVALID';
      case 'email_verified': return 'EMAIL_NOT_VERIFIED';
      case 'sub': return error.reason === 'missing' ? 'SUBJECT_MISSING' : 'CLAIMS_INVALID';
      case 'nbf':
      case 'iat': return error.reason === 'check_failed' ? 'TOKEN_NOT_YET_VALID' : 'CLAIMS_INVALID';
      default: return 'CLAIMS_INVALID';
    }
  }
  return 'UNKNOWN_VERIFICATION_FAILURE';
}
const claimsSchema = z.object({
  sub: z.string().min(1).max(255).regex(/^\S+$/),
  email: z.string().trim().toLowerCase().max(320).email(),
  email_verified: z.literal(true),
  aud: z.string(), iss: z.enum(['https://accounts.google.com', 'accounts.google.com']),
  exp: z.number().int(), iat: z.number().int(),
  azp: z.string().optional(),
});
export type GoogleIdentity = { googleSub: string; email: string };
export interface GoogleIdentityVerifier { verify(token: string): Promise<GoogleIdentity> }
export class GoogleVerifier implements GoogleIdentityVerifier {
  constructor(private readonly config: GoogleConfig,
    private readonly keys: JWTVerifyGetKey = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs')),
    private readonly now: () => Date = () => new Date()) {}
  async verify(token: string): Promise<GoogleIdentity> {
    if (!this.config.clientId) throw new HttpError('SERVICE_UNAVAILABLE');
    try {
      token = normalizeGoogleCredential(token);
      const now = this.now();
      const { payload } = await jwtVerify(token, async (...args) => {
        try { return await this.keys(...args); }
        catch { throw new GoogleVerificationFailure('JWKS_LOOKUP_FAILED'); }
      }, {
        algorithms: ['RS256'], audience: this.config.clientId,
        issuer: ['https://accounts.google.com', 'accounts.google.com'],
        requiredClaims: ['sub', 'email', 'email_verified', 'iat', 'exp'], currentDate: now, clockTolerance: 0,
      });
      const parsed = claimsSchema.safeParse(payload);
      if (!parsed.success) {
        // Inspect only after cryptographic verification. Emit a fixed category, never values.
        if (payload.sub == null || (typeof payload.sub === 'string' && payload.sub.trim() === '')) throw new GoogleVerificationFailure('SUBJECT_MISSING');
        if (payload.email == null || (typeof payload.email === 'string' && payload.email.trim() === '')) throw new GoogleVerificationFailure('EMAIL_MISSING');
        if (payload.email_verified !== true) throw new GoogleVerificationFailure('EMAIL_NOT_VERIFIED');
        if (parsed.error.issues.some(issue => issue.path[0] === 'aud' || issue.path[0] === 'azp')) throw new GoogleVerificationFailure('AUDIENCE_INVALID');
        if (parsed.error.issues.some(issue => issue.path[0] === 'iss')) throw new GoogleVerificationFailure('ISSUER_INVALID');
        throw new GoogleVerificationFailure('CLAIMS_INVALID');
      }
      const claims = parsed.data;
      if (claims.aud !== this.config.clientId || (claims.azp !== undefined && claims.azp !== this.config.clientId)) throw new GoogleVerificationFailure('AUDIENCE_INVALID');
      if (claims.iat > now.getTime() / 1000) throw new GoogleVerificationFailure('TOKEN_NOT_YET_VALID');
      if (claims.exp <= now.getTime() / 1000) throw new GoogleVerificationFailure('TOKEN_EXPIRED');
      if (claims.exp <= claims.iat) throw new GoogleVerificationFailure('CLAIMS_INVALID');
      return { googleSub: claims.sub, email: claims.email };
    } catch (error) {
      if (error instanceof GoogleVerificationFailure) throw error;
      throw new GoogleVerificationFailure(categorize(error));
    }
  }
}
