import { prisma } from "../lib/prisma";
import { ListingStatus, NotificationType } from "@prisma/client";
import { queueService, QUEUES } from "./queue.service";

export const processRenewalReminders = async (): Promise<void> => {
  const now = new Date();
  const threeDaysInFuture = new Date();
  threeDaysInFuture.setDate(now.getDate() + 3);

  const expiringListings = await prisma.listing.findMany({
    where: {
      status: ListingStatus.PUBLISHED,
      expiresAt: {
        gte: now,
        lte: threeDaysInFuture,
      },
    },
    include: {
      provider: true,
    },
  });

  for (const listing of expiringListings) {
    await queueService.send(QUEUES.NOTIFICATION, {
      userId: listing.provider.userId,
      type: NotificationType.EXPIRATION_REMINDER,
      title: "Listing Expiring Soon",
      message: `Your listing "${listing.titleEn}" expires in less than 3 days. Renew now to avoid interruption.`,
    });
  }
};
