export interface DeadLetterPayload {
  sourceQueue: string;
  failedPayload: unknown;
  error: string;
}

export const handleDeadLetterJob = async (
  payload: DeadLetterPayload,
): Promise<void> => {
  console.error("[Dead-Letter Queue Alert]", {
    timestamp: new Date().toISOString(),
    sourceQueue: payload.sourceQueue,
    error: payload.error,
    failedPayload: payload.failedPayload,
  });
};
