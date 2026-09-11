import { normalizeGoogleCredential, GoogleVerificationFailure } from '../src/auth/google-verifier.js';
import { HttpError } from '../src/errors.js';

// Manual tooling only. Consume the supplied environment entry even on failure.
export function readGoogleTestCredential(environment: NodeJS.ProcessEnv, nodeEnv: string): string {
  let raw = environment.AKGEBEYA_GOOGLE_TEST_ID_TOKEN;
  delete environment.AKGEBEYA_GOOGLE_TEST_ID_TOKEN;
  try {
    if (nodeEnv !== 'development' && nodeEnv !== 'test') throw new HttpError('SERVICE_UNAVAILABLE');
    return normalizeGoogleCredential(raw ?? '');
  } finally { raw = undefined; }
}

export function preflightGoogleTestCredential(environment: NodeJS.ProcessEnv) {
  try {
    // No dotenv/config loading, JWT decoding, signing, network or backend startup.
    readGoogleTestCredential(environment, environment.NODE_ENV ?? 'development');
    return { stage: 'private credential input', code: 'FORMAT_ACCEPTABLE', reason: 'FORMAT_ACCEPTABLE' };
  } catch (error) {
    return { stage: 'private credential input', code: 'TOKEN_FORMAT_INVALID',
      reason: error instanceof GoogleVerificationFailure ? error.formatReason ?? 'OTHER_FORMAT_ERROR' : 'OTHER_FORMAT_ERROR' };
  }
}
