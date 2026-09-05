import { prisma } from "../lib/prisma";
import {
  Payment,
  PaymentStatus,
  ListingStatus,
  Currency,
} from "@prisma/client";

export class PaymentRepository {
  async createPendingPayment(data: {
    listingId: string;
    providerId: string;
    amount: number;
    txRef: string;
    idempotencyKey: string;
  }): Promise<Payment> {
    return prisma.payment.create({
      data: {
        listingId: data.listingId,
        providerId: data.providerId,
        amount: data.amount,
        currency: Currency.ETB,
        status: PaymentStatus.PENDING,
        txRef: data.txRef,
        idempotencyKey: data.idempotencyKey,
      },
    });
  }

  async findByTxRef(txRef: string): Promise<Payment | null> {
    return prisma.payment.findUnique({
      where: { txRef },
      include: { listing: true },
    });
  }

  async processIdempotentWebhook(
    txRef: string,
    chapaRef: string,
    rawPayload: Record<string, unknown>,
  ): Promise<{ payment: Payment; alreadyProcessed: boolean }> {
    return prisma.$transaction(async (tx) => {
      const existingPayment = await tx.payment.findUnique({
        where: { txRef },
        include: { listing: true },
      });

      if (!existingPayment) {
        throw new Error(`Payment with tx_ref ${txRef} not found`);
      }

      if (existingPayment.status === PaymentStatus.SUCCESS) {
        return { payment: existingPayment, alreadyProcessed: true };
      }

      const updatedPayment = await tx.payment.update({
        where: { id: existingPayment.id },
        data: {
          status: PaymentStatus.SUCCESS,
          chapaRef,
          rawPayload: rawPayload as object,
        },
      });

      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 30);

      await tx.listing.update({
        where: { id: existingPayment.listingId },
        data: {
          status: ListingStatus.PUBLISHED,
          publishedAt: new Date(),
          expiresAt,
        },
      });

      return { payment: updatedPayment, alreadyProcessed: false };
    });
  }
}

export const paymentRepository = new PaymentRepository();
