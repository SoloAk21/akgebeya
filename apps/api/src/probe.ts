import type { PrismaClient } from './generated/prisma/client.js';

export const PROBE_ID = 'foundation';
export const PROBE_MESSAGE = 'AkGebeya database foundation verified';

export async function saveProbe(database: PrismaClient) {
  return database.foundationProbe.upsert({
    where: { id: PROBE_ID },
    create: { id: PROBE_ID, message: PROBE_MESSAGE },
    update: { message: PROBE_MESSAGE },
  });
}

export async function readProbe(database: PrismaClient) {
  return database.foundationProbe.findUnique({ where: { id: PROBE_ID } });
}
