import type { Provider, Verification } from '../generated/prisma/client.js';
import type { ProviderRole } from '../generated/prisma/enums.js';

export type ProviderInput = { role: ProviderRole; nameEn: string; nameAm?: string; descriptionEn?: string; descriptionAm?: string };
export type Review = Pick<Verification, 'id' | 'status' | 'expiresAt' | 'reviewedAt' | 'createdAt'>;
export type ProviderRecord = Provider & { review: Review | null };
export interface ProviderStore {
  record: ProviderRecord;
  isActiveAdmin(userId: string): Promise<boolean>;
  expirePending(at: Date): Promise<void>;
  submit(expiresAt: Date): Promise<void>;
  decide(id: string, status: 'APPROVED' | 'REJECTED', reviewerId: string, at: Date, expiresAt: Date): Promise<void>;
  setStatus(status: 'ACTIVE' | 'PENDING'): Promise<void>;
  reload(): Promise<ProviderRecord>;
}
export interface ProviderRepository {
  create(userId: string, input: ProviderInput): Promise<ProviderRecord>;
  findOwned(userId: string): Promise<ProviderRecord | null>;
  withProvider<T>(selector: { userId: string } | { id: string }, run: (store: ProviderStore) => Promise<T>): Promise<T>;
}
