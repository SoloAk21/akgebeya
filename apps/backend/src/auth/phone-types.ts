import type { AuthRepository } from './types.js';

export type PhoneChallenge = {
  id: string; phone: string; otpHash: string; expiresAt: Date; resendAvailableAt: Date;
  attemptCount: number; consumedAt: Date | null; revokedAt: Date | null; createdAt: Date; updatedAt: Date;
};
export interface PhoneOtpStore {
  authRepository: AuthRepository;
  current(): Promise<PhoneChallenge | null>;
  replace(challenge: PhoneChallenge): Promise<void>;
  update(id: string, data: Partial<Pick<PhoneChallenge, 'attemptCount' | 'consumedAt' | 'revokedAt' | 'updatedAt'>>): Promise<void>;
  resolveUser(displayName: string): Promise<{ id: string }>;
}
export interface PhoneOtpRepository {
  // Callback completes in one transaction, serialized by normalized phone.
  withPhone<T>(phone: string, run: (store: PhoneOtpStore) => Promise<T>): Promise<T>;
}
export type OtpDelivery = { phone: string; challengeId: string; otp: string; expiresAt: string };
export interface OtpTransport {
  readonly available: boolean;
  send(delivery: OtpDelivery): Promise<void>;
}
