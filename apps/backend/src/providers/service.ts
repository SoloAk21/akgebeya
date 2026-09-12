import { z } from 'zod';
import { ProviderRole } from '../generated/prisma/enums.js';
import type { AuthContext } from '../auth/types.js';
import type { ProviderConfig } from '../config.js';
import { HttpError } from '../errors.js';
import type { ProviderRecord, ProviderRepository } from './types.js';

const text = (max: number) => z.string().trim().min(1).max(max).refine(value => !/\p{Cc}/u.test(value));
export const providerInput = z.object({
  role: z.enum(ProviderRole), nameEn: text(160), nameAm: text(160).optional(),
  descriptionEn: text(4000).optional(), descriptionAm: text(4000).optional(),
}).strict();
export const decisionInput = z.object({ verificationId: z.string().uuid() }).strict();

export function providerView(provider: ProviderRecord, at: Date) {
  const review = provider.review;
  const validRole = z.enum(ProviderRole).safeParse(provider.role).success;
  const state = review?.status === 'REJECTED' ? 'REJECTED'
    : review && review.expiresAt > at && review.status === 'PENDING' ? 'PENDING'
    : review && review.expiresAt > at && review.status === 'APPROVED' && provider.status === 'ACTIVE' && validRole ? 'VERIFIED'
    : 'UNVERIFIED';
  return {
    id: provider.id, role: provider.role, nameEn: provider.nameEn, nameAm: provider.nameAm,
    descriptionEn: provider.descriptionEn, descriptionAm: provider.descriptionAm, status: provider.status,
    verification: { id: review?.id ?? null, state, verified: state === 'VERIFIED',
      reviewedAt: review?.reviewedAt ?? null, expiresAt: review?.expiresAt ?? null },
  };
}
export function verifiedProviderId(context:AuthContext, provider:ProviderRecord|null, allowedRoles:readonly ProviderRole[], expectedProviderId?:string, at=new Date()) {
  if (!provider || provider.userId !== context.user.id || (expectedProviderId !== undefined && expectedProviderId !== provider.id)
    || !provider.role || !allowedRoles.includes(provider.role) || !providerView(provider,at).verification.verified) throw new HttpError('FORBIDDEN');
  return provider.id;
}

export class ProviderService {
  constructor(private readonly repository: ProviderRepository, private readonly config: ProviderConfig,
    private readonly now: () => Date = () => new Date()) {}
  async create(context: AuthContext, input: unknown) {
    const parsed = providerInput.safeParse(input);
    if (!parsed.success) throw new HttpError('BAD_REQUEST');
    return providerView(await this.repository.create(context.user.id, parsed.data), this.now());
  }
  async me(context: AuthContext) {
    const provider = await this.repository.findOwned(context.user.id);
    if (!provider) throw new HttpError('PROVIDER_NOT_FOUND');
    if (provider.userId !== context.user.id) throw new HttpError('FORBIDDEN');
    return providerView(provider, this.now());
  }
  async submit(context: AuthContext) {
    return this.repository.withProvider({ userId: context.user.id }, async store => {
      const p = store.record; const at = this.now();
      if (p.userId !== context.user.id || p.status === 'SUSPENDED' || !z.enum(ProviderRole).safeParse(p.role).success) throw new HttpError('FORBIDDEN');
      if (p.review && p.review.expiresAt > at && ['PENDING', 'APPROVED'].includes(p.review.status)) throw new HttpError('PROVIDER_CONFLICT');
      await store.expirePending(at);
      await store.submit(new Date(at.getTime() + this.config.pendingTtlSeconds * 1000));
      return providerView(await store.reload(), this.now()).verification;
    });
  }
  async decide(context: AuthContext, providerId: string, input: unknown, approve: boolean) {
    if (context.user.role !== 'ADMIN') throw new HttpError('FORBIDDEN');
    const parsed = decisionInput.safeParse(input);
    if (!z.string().uuid().safeParse(providerId).success || !parsed.success) throw new HttpError('BAD_REQUEST');
    return this.repository.withProvider({ id: providerId }, async store => {
      const p = store.record;
      if (p.userId === context.user.id || !await store.isActiveAdmin(context.user.id)) throw new HttpError('FORBIDDEN');
      const at = this.now();
      if (!p.review || p.review.id !== parsed.data.verificationId || p.review.status !== 'PENDING' || p.review.expiresAt <= at) throw new HttpError('PROVIDER_CONFLICT');
      if (p.status === 'SUSPENDED' || !z.enum(ProviderRole).safeParse(p.role).success) throw new HttpError('FORBIDDEN');
      await store.decide(p.review.id, approve ? 'APPROVED' : 'REJECTED', context.user.id, at,
        approve ? new Date(at.getTime() + this.config.approvalTtlSeconds * 1000) : p.review.expiresAt);
      await store.setStatus(approve ? 'ACTIVE' : 'PENDING');
      return providerView(await store.reload(), this.now()).verification;
    });
  }
  async requireVerified(context: AuthContext, allowedRoles: readonly ProviderRole[], expectedProviderId?: string) {
    const provider = await this.repository.findOwned(context.user.id);
    return verifiedProviderId(context,provider,allowedRoles,expectedProviderId,this.now());
  }
}
