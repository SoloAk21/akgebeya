import { Request, Response } from "express";
import {
  initializePaymentSchema,
  chapaWebhookSchema,
} from "../schemas/payment.schema";
import { paymentService } from "../services/payment.service";

export const initializePayment = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ status: "error", message: "Unauthorized" });
      return;
    }

    const parseResult = initializePaymentSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({
        status: "error",
        message: "Validation failure",
        errors: parseResult.error.flatten(),
      });
      return;
    }

    const result = await paymentService.initializePayment(
      req.user.id,
      parseResult.data,
    );

    res.status(200).json({
      status: "success",
      data: result,
    });
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Payment initialization failed";
    res.status(400).json({ status: "error", message });
  }
};

export const handleChapaWebhook = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const parseResult = chapaWebhookSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({
        status: "error",
        message: "Invalid webhook payload",
        errors: parseResult.error.flatten(),
      });
      return;
    }

    const { payment, alreadyProcessed } =
      await paymentService.verifyAndProcessWebhook(
        parseResult.data,
        req.body as Record<string, unknown>,
      );

    res.status(200).json({
      status: "success",
      message: alreadyProcessed
        ? "Webhook already processed"
        : "Payment verified and listing published",
      data: {
        paymentId: payment.id,
        txRef: payment.txRef,
        alreadyProcessed,
      },
    });
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Webhook processing failed";
    res.status(400).json({ status: "error", message });
  }
};
