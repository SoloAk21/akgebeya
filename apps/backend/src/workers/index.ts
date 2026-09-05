import { Job } from "pg-boss";
import { queueService, QUEUES } from "./queue.service";
import { processListingExpirations } from "./expiration.worker";
import { processRenewalReminders } from "./renewal.worker";
import {
  processWebhookRetry,
  WebhookRetryPayload,
} from "./webhook-retry.worker";
import {
  processNotificationJob,
  NotificationJobPayload,
} from "./notification.worker";
import { handleDeadLetterJob, DeadLetterPayload } from "./dead-letter.handler";

export const initWorkers = async (): Promise<void> => {
  try {
    const boss = await queueService.start();

    for (const queueName of Object.values(QUEUES)) {
      await boss.createQueue(queueName);
    }

    await boss.work(
      QUEUES.NOTIFICATION,
      async (jobs: Job<NotificationJobPayload>[]) => {
        for (const job of jobs) {
          await processNotificationJob(job.data);
        }
      },
    );

    await boss.work(
      QUEUES.WEBHOOK_RETRY,
      async (jobs: Job<WebhookRetryPayload>[]) => {
        for (const job of jobs) {
          await processWebhookRetry(job.data);
        }
      },
    );

    await boss.work(
      QUEUES.DEAD_LETTER,
      async (jobs: Job<DeadLetterPayload>[]) => {
        for (const job of jobs) {
          await handleDeadLetterJob(job.data);
        }
      },
    );

    await boss.schedule(QUEUES.LISTING_EXPIRATION, "0 0 * * *");
    await boss.work(QUEUES.LISTING_EXPIRATION, async () => {
      await processListingExpirations();
    });

    await boss.schedule(QUEUES.EXPIRATION_RENEWAL, "0 6 * * *");
    await boss.work(QUEUES.EXPIRATION_RENEWAL, async () => {
      await processRenewalReminders();
    });

    console.log(
      "[Worker Engine] All background queues created and workers successfully registered.",
    );
  } catch (err) {
    console.warn(
      "[Worker Engine Warning] Queue initialization notice:",
      err instanceof Error ? err.message : err,
    );
  }
};
