import { AuthError } from './auth-security.js';
import type { PrismaClient } from './generated/prisma/client.js';
import { ProviderType } from './generated/prisma/enums.js';

export function providerInput(value: unknown): { providerType: ProviderType } {
  if (typeof value !== 'object' || value === null || Array.isArray(value)
    || Object.keys(value).length !== 1 || !('providerType' in value)
    || typeof value.providerType !== 'string'
    || !Object.values(ProviderType).includes(value.providerType as ProviderType)) {
    throw new AuthError(400, 'INVALID_PROVIDER_APPLICATION', 'Choose Owner, Broker, Agent, Agency, or Developer.');
  }
  return { providerType: value.providerType as ProviderType };
}

export const applicationFields = { providerType: true, status: true, submittedAt: true } as const;

export async function applyAsProvider(database: PrismaClient, accountId: string, input: { providerType: ProviderType }) {
  return database.$transaction(async tx => {
    // The account primary key makes retries and competing submissions atomic.
    // Never update an existing application: a retry must preserve a review decision.
    const inserted = await tx.providerApplication.createMany({
      data: { accountId, providerType: input.providerType, status: 'PENDING' }, skipDuplicates: true,
    });
    const application = await tx.providerApplication.findUniqueOrThrow({ where: { accountId }, select: applicationFields });
    if (application.providerType !== input.providerType) {
      throw new AuthError(409, 'APPLICATION_EXISTS', 'You already applied with a different provider type. Reload your application to see it.');
    }
    return { created: inserted.count === 1, application };
  });
}
