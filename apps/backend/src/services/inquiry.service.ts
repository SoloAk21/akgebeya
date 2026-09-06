import {
  inquiryRepository,
  InquiryRepository,
} from "../repositories/inquiry.repository";
import {
  listingRepository,
  ListingRepository,
} from "../repositories/listing.repository";
import {
  providerRepository,
  ProviderRepository,
} from "../repositories/provider.repository";
import { queueService, QUEUES } from "../workers/queue.service";
import {
  CreateInquiryInput,
  UpdateInquiryStatusInput,
} from "../schemas/inquiry.schema";
import { Inquiry, InquiryStatus, NotificationType } from "@prisma/client";

export class InquiryService {
  constructor(
    private inquiryRepo: InquiryRepository = inquiryRepository,
    private listingRepo: ListingRepository = listingRepository,
    private providerRepo: ProviderRepository = providerRepository,
  ) {}

  async createInquiry(
    buyerUserId: string,
    input: CreateInquiryInput,
  ): Promise<Inquiry> {
    const listing = await this.listingRepo.findById(input.listingId);
    if (!listing) {
      throw new Error("Listing not found");
    }

    const inquiry = await this.inquiryRepo.createInquiry(
      buyerUserId,
      listing.providerId,
      input,
    );

    const provider = await this.providerRepo.findById(listing.providerId);
    if (provider) {
      await queueService.send(QUEUES.NOTIFICATION, {
        userId: provider.userId,
        type: NotificationType.INQUIRY_RECEIVED,
        title: "New Property Inquiry",
        message: `New lead received for "${listing.titleEn}". Contact: ${input.buyerPhone}`,
        metadata: { inquiryId: inquiry.id, listingId: listing.id },
      });
    }

    return inquiry;
  }

  async getProviderInquiries(
    providerUserId: string,
    status?: InquiryStatus,
  ): Promise<Inquiry[]> {
    const provider = await this.providerRepo.findByUserId(providerUserId);
    if (!provider) {
      throw new Error("Provider profile required to access CRM inquiries");
    }

    return this.inquiryRepo.findInquiriesByProvider(provider.id, status);
  }

  async updateInquiryStatus(
    providerUserId: string,
    inquiryId: string,
    input: UpdateInquiryStatusInput,
  ): Promise<Inquiry> {
    const provider = await this.providerRepo.findByUserId(providerUserId);
    if (!provider) {
      throw new Error("Provider profile required");
    }

    const inquiry = await this.inquiryRepo.findInquiryById(inquiryId);
    if (!inquiry) {
      throw new Error("Inquiry not found");
    }

    if (inquiry.providerId !== provider.id) {
      throw new Error("Unauthorized to modify this CRM inquiry");
    }

    return this.inquiryRepo.updateInquiryStatus(
      inquiryId,
      input.status,
      input.notes,
    );
  }
}

export const inquiryService = new InquiryService();
