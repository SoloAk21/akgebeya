import { GoogleVerificationFailure, googleFailureCategories, googleFormatReasons } from '../src/auth/google-verifier.js';
const reasons = {
  ...Object.fromEntries(googleFailureCategories.map(category => [category, category])) as Record<typeof googleFailureCategories[number], string>,
  STAGE_STARTED: 'Verification stage started',
  UNAUTHORIZED: 'Authentication verification rejected the credential or session',
  ACCOUNT_LINKING_CONFLICT: 'Account conflict rejected; no automatic linking',
  SERVICE_UNAVAILABLE: 'Required authentication configuration or service unavailable',
  BAD_REQUEST: 'Request rejected by input validation',
  INTERNAL_ERROR: 'Backend returned a safe internal error',
  CONFIGURATION_FAILED: 'Check local backend configuration; values withheld',
  INPUT_INVALID: 'Private credential input is empty or exceeds the size limit',
  COMMAND_FAILED: 'Local verification command returned failure; output withheld',
  COMMAND_TIMEOUT: 'Local verification command timed out',
  COMMAND_START_FAILED: 'Local verification command could not start',
  HTTP_UNEXPECTED: 'HTTP status differed from the expected result; body withheld',
  RESPONSE_INVALID: 'Response format was invalid; body withheld',
  ERR_ASSERTION: 'Verification assertion failed; compared values withheld',
  VALIDATION_FAILED: 'Validation failed; input values withheld',
  P1001: 'Database connection could not be established',
  P1002: 'Database connection timed out',
  P2002: 'Database uniqueness conflict',
  P2021: 'Required database table missing',
  P2022: 'Required database column missing',
  P2025: 'Expected database record missing',
  P2010: 'Database query failed; query and metadata withheld',
  P2028: 'Database transaction failed or expired',
  VERIFICATION_FAILED: 'Verification failed; exception details withheld',
} as const;
type Code = keyof typeof reasons;
export type Stage = 'environment/config validation' | 'private credential input' | 'Google signature/claims verification'
  | 'backend startup' | 'negative HTTP checks' | 'POST /api/v1/auth/google' | 'GET /api/v1/auth/me'
  | 'repeat Google login' | 'POST /api/v1/auth/logout' | 'post-logout /auth/me rejection'
  | 'Neon user identity verification' | 'session hash/revocation verification' | 'Postman collection' | 'cleanup';
type Details = { stage: Stage; httpStatus?: number; code: Code; reason: string };
export class VerificationFailure extends Error {
  constructor(readonly details: Details) { super(details.reason); }
}
function safeCode(value: unknown): Code | undefined {
  return typeof value === 'string' && Object.hasOwn(reasons, value) ? value as Code : undefined;
}
export class VerificationDiagnostics {
  private stage: Stage = 'environment/config validation';
  private status: number | undefined;
  private override: Code | undefined;
  constructor(private readonly write: (line: string) => void = line => console.error(line)) {}
  enter(stage: Stage) {
    this.stage = stage; this.status = undefined; this.override = undefined;
    this.write(JSON.stringify({ stage, code: 'STAGE_STARTED', reason: reasons.STAGE_STARTED }));
  }
  mark(code: Code) { this.override = code; }
  http(status: number) { this.status = Number.isInteger(status) && status >= 100 && status <= 599 ? status : undefined; }
  failure(code: Code): VerificationFailure {
    return new VerificationFailure({ stage: this.stage, ...(this.status === undefined ? {} : { httpStatus: this.status }),
      code, reason: reasons[code] });
  }
  capture(error: unknown): VerificationFailure {
    if (error instanceof VerificationFailure) return error;
    if (error instanceof GoogleVerificationFailure) {
      const failure = this.failure(error.category);
      if (error.category === 'TOKEN_FORMAT_INVALID') {
        const reason = error.formatReason;
        return new VerificationFailure({ ...failure.details,
          reason: reason !== undefined && googleFormatReasons.includes(reason) ? reason : 'OTHER_FORMAT_ERROR' });
      }
      return failure;
    }
    const code = typeof error === 'object' && error !== null && 'code' in error ? safeCode(error.code) : undefined;
    const validation = error instanceof Error && error.name === 'ZodError';
    return this.failure(this.override ?? code ?? (validation ? 'VALIDATION_FAILED' : 'VERIFICATION_FAILED'));
  }
  expectHttp(response: { status: number; body: unknown }, expected: number) {
    this.http(response.status);
    if (response.status === expected) return;
    const body = response.body;
    const error = typeof body === 'object' && body !== null && 'error' in body ? body.error : undefined;
    const code = typeof error === 'object' && error !== null && 'code' in error ? safeCode(error.code) : undefined;
    throw this.failure(code ?? 'HTTP_UNEXPECTED');
  }
  report(error: unknown) { this.write(JSON.stringify(this.capture(error).details)); }
}
