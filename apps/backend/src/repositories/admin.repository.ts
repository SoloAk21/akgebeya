import { prisma } from "../lib/prisma";
import {
  Listing,
  Report,
  Verification,
  ListingStatus,
  VerificationStatus,
} from "@prisma/client";

export class AdminRepository {
  async createListingReport(
    listingId: string,
    reporterId: string | undefined,
    data: { reason: string; details?: string },
  ): Promise<Report> {
    const listing = await prisma.listing.findUnique({
      where: { id: listingId },
    });

    if (!listing) {
      throw new Error("Listing not found");
    }

    return prisma.$transaction(
      async (tx) => {
        const report = await tx.report.create({
          data: {
            listingId,
            reporterId,
            reason: data.reason,
            details: data.details,
          },
        });

        const reportCount = await tx.report.count({
          where: { listingId },
        });

        if (reportCount >= 3) {
          await tx.listing.update({
            where: { id: listingId },
            data: {
              isQuarantined: true,
              status: ListingStatus.QUARANTINED,
            },
          });
        }

        return report;
      },
      { timeout: 10000 },
    );
  }

  async findQuarantinedListings(): Promise<Listing[]> {
    return prisma.listing.findMany({
      where: {
        OR: [{ isQuarantined: true }, { status: ListingStatus.QUARANTINED }],
      },
      include: {
        provider: {
          include: { user: true },
        },
        location: true,
        reports: true,
      },
      orderBy: { updatedAt: "desc" },
    });
  }

  async moderateListing(
    listingId: string,
    action: "APPROVE" | "REJECT",
    _reason?: string,
  ): Promise<Listing> {
    const listing = await prisma.listing.findUnique({
      where: { id: listingId },
    });

    if (!listing) {
      throw new Error("Listing not found");
    }

    const isApproved = action === "APPROVE";
    return prisma.listing.update({
      where: { id: listingId },
      data: {
        isQuarantined: !isApproved,
        status: isApproved ? ListingStatus.PUBLISHED : ListingStatus.REJECTED,
      },
      include: { location: true },
    });
  }

  async findPendingVerifications(): Promise<Verification[]> {
    return prisma.verification.findMany({
      where: { status: VerificationStatus.PENDING },
      include: {
        provider: {
          include: { user: true },
        },
      },
      orderBy: { createdAt: "asc" },
    });
  }

  async reviewVerification(
    verificationId: string,
    adminUserId: string,
    status: "APPROVED" | "REJECTED",
    rejectionReason?: string,
  ): Promise<Verification> {
    const verification = await prisma.verification.findUnique({
      where: { id: verificationId },
    });

    if (!verification) {
      throw new Error("Verification document not found");
    }

    const isApproved = status === "APPROVED";
    const newStatus = isApproved
      ? VerificationStatus.VERIFIED
      : VerificationStatus.REJECTED;

    return prisma.$transaction(
      async (tx) => {
        const updatedVerification = await tx.verification.update({
          where: { id: verificationId },
          data: {
            status: isApproved
              ? VerificationStatus.VERIFIED
              : VerificationStatus.REJECTED,
            rejectionReason,
            reviewedBy: adminUserId,
            reviewedAt: new Date(),
          },
        });

        await tx.provider.update({
          where: { id: verification.providerId },
          data: {
            verificationStatus: newStatus,
            isVerified: isApproved,
          },
        });

        return updatedVerification;
      },
      { timeout: 10000 },
    );
  }
}

export const adminRepository = new AdminRepository();
