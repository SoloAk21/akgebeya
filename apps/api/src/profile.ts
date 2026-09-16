import { AuthError } from './auth-security.js';

export function profileInput(value: unknown): { displayName: string } {
  if (typeof value !== 'object' || value === null || Array.isArray(value)
    || Object.keys(value).length !== 1 || !('displayName' in value)
    || typeof value.displayName !== 'string') {
    throw new AuthError(400, 'INVALID_PROFILE', 'Send only a display name.');
  }
  const displayName = value.displayName.trim();
  if (!displayName || displayName.length > 80 || /\p{Cc}|\p{Cf}/u.test(displayName)) {
    throw new AuthError(400, 'INVALID_PROFILE', 'Use 1–80 characters without control characters for your display name.');
  }
  return { displayName };
}
