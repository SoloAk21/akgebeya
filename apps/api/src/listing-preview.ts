import type { PrismaClient } from './generated/prisma/client.js';
import type { ListingCopy } from './gemini.js';
import { readListing } from './listing.js';

interface Photo { id: string; width: number; height: number; byteSize: number; createdAt: Date }
interface GeneratedCopy { copy: ListingCopy; sourceVersion: number; model: string; generatedAt: Date }

export async function readListingPreview(database: PrismaClient, accountId: string, id: string) {
  // All reads share one database snapshot, including profile/provider changes.
  // No writer locks or external calls are needed to render this private preview.
  return database.$transaction(async tx => {
    const listing = await readListing(tx, accountId, id);
    const [photos, versions, copies, providers] = await Promise.all([
      tx.$queryRaw<Photo[]>`
        SELECT id, width, height, "byteSize", "createdAt" FROM akgebeya_foundation.listing_media
        WHERE "listingId" = ${listing.id}::uuid ORDER BY position`,
      tx.$queryRaw<Array<{ mediaVersion: number }>>`
        SELECT "mediaVersion" FROM akgebeya_foundation.listing_draft WHERE id = ${listing.id}::uuid`,
      tx.$queryRaw<GeneratedCopy[]>`
        SELECT copy, "sourceVersion", model, "generatedAt" FROM akgebeya_foundation.listing_ai_content
        WHERE "listingId" = ${listing.id}::uuid`,
      tx.$queryRaw<Array<{ displayName: string | null; providerType: string | null }>>`
        SELECT a."displayName", p."providerType" FROM akgebeya_foundation.account a
        LEFT JOIN akgebeya_foundation.provider_application p ON p."accountId" = a.id WHERE a.id = ${accountId}::uuid`,
    ]);
    const saved = copies[0];
    return {
      listing,
      media: photos.map(photo => ({ ...photo, url: `/api/listings/${listing.id}/media/${photo.id}` })),
      mediaVersion: versions[0]!.mediaVersion,
      copy: saved ? { en: saved.copy.en, am: saved.copy.am, sourceVersion: saved.sourceVersion,
        model: saved.model, generatedAt: saved.generatedAt } : null,
      copyStale: saved ? saved.sourceVersion !== listing.version : false,
      provider: providers[0] ?? { displayName: null, providerType: null },
    };
  }, { isolationLevel: 'RepeatableRead' });
}
