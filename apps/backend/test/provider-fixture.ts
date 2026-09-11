import { randomUUID } from 'node:crypto';
import type { ProviderRecord, ProviderRepository, ProviderStore } from '../src/providers/types.js';
import { HttpError } from '../src/errors.js';
import { createAuthFixture } from './auth-fixture.js';
import { ProviderService } from '../src/providers/service.js';
import { parseProviderConfig } from '../src/config.js';
export function providerFixture() {
  const auth = createAuthFixture(); const records = new Map<string, ProviderRecord>();
  const repository: ProviderRepository = {
    async create(userId, input) {
      if ([...records.values()].some(p => p.userId === userId)) throw new HttpError('PROVIDER_CONFLICT');
      const p: ProviderRecord = { id: randomUUID(), userId, ...input, nameAm: input.nameAm ?? null,
        descriptionEn: input.descriptionEn ?? null, descriptionAm: input.descriptionAm ?? null,
        status: 'PENDING', createdAt: auth.getNow(), updatedAt: auth.getNow(), review: null };
      records.set(p.id, p); return p;
    },
    async findOwned(userId) { return [...records.values()].find(p => p.userId === userId) ?? null; },
    async withProvider<T>(selector: { id: string } | { userId: string }, run: (store: ProviderStore) => Promise<T>) {
      const p = [...records.values()].find(p => 'id' in selector ? p.id === selector.id : p.userId === selector.userId);
      if (!p) throw new HttpError('PROVIDER_NOT_FOUND');
      return run({ record: p,
        async isActiveAdmin(id) { const u = auth.repository.users.get(id); return u?.role === 'ADMIN' && u.status === 'ACTIVE' && !u.deletedAt; },
        async expirePending() { if (p.review?.status === 'PENDING') p.review.status = 'EXPIRED'; },
        async submit(expiresAt) { p.review = { id: randomUUID(), status: 'PENDING', expiresAt, reviewedAt: null, createdAt: auth.getNow() }; },
        async decide(_id, status, _reviewer, at, expiresAt) { p.review = { ...p.review!, status, reviewedAt: at, expiresAt }; },
        async setStatus(status) { p.status = status; },
        async reload() { return p; },
      });
    },
  };
  const admin = { ...auth.user, id: randomUUID(), role: 'ADMIN' as const };
  const other = { ...auth.user, id: randomUUID() };
  auth.repository.users.set(admin.id, admin); auth.repository.users.set(other.id, other);
  const service = new ProviderService(repository, parseProviderConfig({}), auth.getNow);
  return { ...auth, records, providerService: service,
    context: { user: auth.user, sessionId: randomUUID() }, adminContext: { user: admin, sessionId: randomUUID() },
    otherContext: { user: other, sessionId: randomUUID() } };
}
