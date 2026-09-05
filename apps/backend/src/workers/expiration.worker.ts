import { prisma } from "../lib/prisma";
import { ListingStatus, NotificationType } from "@prisma/client";
import { queueService, QUEUES } from "./queue.service";

export const processListingExpirations = async (): Promise<void> => {
  const now = new Date();
  const expiredListings = await prisma.listing.findMany({
    where: {
      status: ListingStatus.PUBLISHED,
      expiresAt: { lte: now },
    },
    include: {
      provider: true,
    },
  });

  for (const listing of expiredListings) {
    await prisma.listing.update({
      where: { id: listing.id },
      data: { status: ListingStatus.EXPIRED },
    });

    await queueService.send(QUEUES.NOTIFICATION, {
      userId: listing.provider.userId,
      type: NotificationType.EXPIRATION_REMINDER,
      title: "Listing Expired",
      message: `Your listing "${listing.titleEn}" has expired. Please renew it to stay published.`,
    });
  }
};
