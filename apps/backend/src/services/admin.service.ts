import {
  adminRepository,
  AdminRepository,
} from "../repositories/admin.repository";
import {
  ReportListingInput,
  ModerateListingInput,
  ReviewVerificationInput,
} from "../schemas/admin.schema";
import { Report, Listing, Verification } from "@prisma/client";

export class AdminService {
  constructor(private adminRepo: AdminRepository = adminRepository) {}

  async reportListing(
    listingId: string,
    reporterId: string | undefined,
    input: ReportListingInput,
  ): Promise<Report> {
    return this.adminRepo.createListingReport(listingId, reporterId, input);
  }

  async getQuarantinedListings(): Promise<Listing[]> {
    return this.adminRepo.findQuarantinedListings();
  }

  async moderateListing(
    listingId: string,
    input: ModerateListingInput,
  ): Promise<Listing> {
    return this.adminRepo.moderateListing(
      listingId,
      input.action,
      input.reason,
    );
  }

  async getPendingVerifications(): Promise<Verification[]> {
    return this.adminRepo.findPendingVerifications();
  }

  async reviewVerification(
    verificationId: string,
    adminUserId: string,
    input: ReviewVerificationInput,
  ): Promise<Verification> {
    return this.adminRepo.reviewVerification(
      verificationId,
      adminUserId,
      input.status,
      input.rejectionReason,
    );
  }
}

export const adminService = new AdminService();
