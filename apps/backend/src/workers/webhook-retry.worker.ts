import { paymentService } from "../services/payment.service";
import { queueService, QUEUES } from "./queue.service";

export interface WebhookRetryPayload {
  tx_ref: string;
  status: string;
  reference?: string;
  rawPayload: Record<string, unknown>;
  attempt: number;
}

export const processWebhookRetry = async (
  payload: WebhookRetryPayload,
): Promise<void> => {
  try {
    await paymentService.verifyAndProcessWebhook(
      {
        tx_ref: payload.tx_ref,
        status: payload.status,
        reference: payload.reference,
      },
      payload.rawPayload,
    );
  } catch (err: unknown) {
    const nextAttempt = payload.attempt + 1;
    if (nextAttempt <= 3) {
      await queueService.send(QUEUES.WEBHOOK_RETRY, {
        ...payload,
        attempt: nextAttempt,
      });
    } else {
      await queueService.send(QUEUES.DEAD_LETTER, {
        sourceQueue: QUEUES.WEBHOOK_RETRY,
        failedPayload: payload,
        error: err instanceof Error ? err.message : "Exceeded retry limit",
      });
    }
  }
};
