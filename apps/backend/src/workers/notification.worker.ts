import { prisma } from "../lib/prisma";
import { NotificationType } from "@prisma/client";

export interface NotificationJobPayload {
  userId: string;
  type: NotificationType;
  title: string;
  message: string;
  metadata?: Record<string, unknown>;
}

export const processNotificationJob = async (
  payload: NotificationJobPayload,
): Promise<void> => {
  await prisma.notification.create({
    data: {
      userId: payload.userId,
      type: payload.type,
      title: payload.title,
      message: payload.message,
      metadata: payload.metadata as object,
    },
  });
};
