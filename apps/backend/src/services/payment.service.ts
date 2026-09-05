import crypto from "crypto";
import { env } from "../config/env.config";
import {
  paymentRepository,
  PaymentRepository,
} from "../repositories/payment.repository";
import {
  listingRepository,
  ListingRepository,
} from "../repositories/listing.repository";
import {
  providerRepository,
  ProviderRepository,
} from "../repositories/provider.repository";
import {
  InitializePaymentInput,
  ChapaWebhookInput,
} from "../schemas/payment.schema";
import { Payment } from "@prisma/client";

export class PaymentService {
  constructor(
    private paymentRepo: PaymentRepository = paymentRepository,
    private listingRepo: ListingRepository = listingRepository,
    private providerRepo: ProviderRepository = providerRepository,
  ) {}

  async initializePayment(
    userId: string,
    input: InitializePaymentInput,
  ): Promise<{ checkoutUrl: string; txRef: string }> {
    const provider = await this.providerRepo.findByUserId(userId);
    if (!provider) {
      throw new Error("Provider profile required");
    }

    const listing = await this.listingRepo.findById(input.listingId);
    if (!listing) {
      throw new Error("Listing not found");
    }

    if (listing.providerId !== provider.id) {
      throw new Error("Unauthorized to initialize payment for this listing");
    }

    const txRef = `AKG-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
    const idempotencyKey = `IDEM-${txRef}`;

    await this.paymentRepo.createPendingPayment({
      listingId: listing.id,
      providerId: provider.id,
      amount: input.amount,
      txRef,
      idempotencyKey,
    });

    if (
      env.NODE_ENV === "development" &&
      env.CHAPA_SECRET_KEY.startsWith("CHASECK_TEST-fake")
    ) {
      return {
        checkoutUrl: `http://localhost:5000/api/v1/payments/mock-checkout?tx_ref=${txRef}`,
        txRef,
      };
    }

    const chapaResponse = await fetch(
      "https://api.chapa.co/v1/transaction/initialize",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.CHAPA_SECRET_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          amount: input.amount.toString(),
          currency: "ETB",
          email: input.email,
          first_name: input.firstName,
          last_name: input.lastName,
          tx_ref: txRef,
          callback_url: `http://localhost:5000/api/v1/payments/webhook/chapa`,
          return_url: `http://localhost:3000/listings/${listing.id}`,
        }),
      },
    );

    const responseData = (await chapaResponse.json()) as {
      status: string;
      data?: { checkout_url: string };
    };

    if (responseData.status !== "success" || !responseData.data?.checkout_url) {
      throw new Error("Failed to initialize payment with Chapa gateway");
    }

    return {
      checkoutUrl: responseData.data.checkout_url,
      txRef,
    };
  }

  verifyWebhookSignature(
    rawBody: string,
    signature: string | undefined,
  ): boolean {
    if (!signature) return false;
    const computedHash = crypto
      .createHmac("sha256", env.CHAPA_WEBHOOK_SECRET)
      .update(rawBody)
      .digest("hex");

    return computedHash === signature;
  }

  async verifyAndProcessWebhook(
    payload: ChapaWebhookInput,
    rawPayload: Record<string, unknown>,
  ): Promise<{ payment: Payment; alreadyProcessed: boolean }> {
    const payment = await this.paymentRepo.findByTxRef(payload.tx_ref);
    if (!payment) {
      throw new Error(`Payment reference ${payload.tx_ref} not found`);
    }

    if (payload.status !== "success" && payload.status !== "completed") {
      throw new Error(`Payment status is ${payload.status}`);
    }

    const chapaRef =
      payload.reference ||
      (payload as { flw_ref?: string }).flw_ref ||
      `CHAPA-${payload.tx_ref}`;

    return this.paymentRepo.processIdempotentWebhook(
      payload.tx_ref,
      chapaRef,
      rawPayload,
    );
  }
}

export const paymentService = new PaymentService();
