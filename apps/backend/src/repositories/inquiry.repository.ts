import { prisma } from "../lib/prisma";
import { Inquiry, InquiryStatus } from "@prisma/client";
import { CreateInquiryInput } from "../schemas/inquiry.schema";

export class InquiryRepository {
  async createInquiry(
    buyerId: string,
    providerId: string,
    data: CreateInquiryInput,
  ): Promise<Inquiry> {
    return prisma.inquiry.create({
      data: {
        listingId: data.listingId,
        buyerId,
        providerId,
        message: data.message,
        buyerPhone: data.buyerPhone,
        status: InquiryStatus.NEW_INQUIRY,
      },
      include: {
        listing: true,
        buyer: {
          select: { fullName: true, phone: true },
        },
      },
    });
  }

  async findInquiriesByProvider(
    providerId: string,
    status?: InquiryStatus,
  ): Promise<Inquiry[]> {
    return prisma.inquiry.findMany({
      where: {
        providerId,
        ...(status ? { status } : {}),
      },
      include: {
        listing: true,
        buyer: {
          select: { fullName: true, phone: true, avatarUrl: true },
        },
      },
      orderBy: { updatedAt: "desc" },
    });
  }

  async findInquiryById(id: string): Promise<Inquiry | null> {
    return prisma.inquiry.findUnique({
      where: { id },
      include: {
        listing: true,
        provider: true,
        buyer: true,
      },
    });
  }

  async updateInquiryStatus(
    id: string,
    status: InquiryStatus,
    notes?: string,
  ): Promise<Inquiry> {
    return prisma.inquiry.update({
      where: { id },
      data: {
        status,
        ...(notes !== undefined ? { notes } : {}),
      },
      include: {
        listing: true,
        buyer: {
          select: { fullName: true, phone: true },
        },
      },
    });
  }
}

export const inquiryRepository = new InquiryRepository();
