import { prisma } from "../lib/prisma";
import {
  Provider,
  Verification,
  ProviderType,
  VerificationStatus,
  UserRole,
} from "@prisma/client";

export class ProviderRepository {
  async findByUserId(userId: string): Promise<Provider | null> {
    return prisma.provider.findUnique({
      where: { userId },
      include: {
        verifications: {
          orderBy: { createdAt: "desc" },
          take: 1,
        },
      },
    });
  }

  async findByPublicProfileUrl(
    publicProfileUrl: string,
  ): Promise<Provider | null> {
    return prisma.provider.findFirst({
      where: {
        publicProfileUrl,
        softDeleted: false,
      },
      include: {
        user: {
          select: {
            fullName: true,
            avatarUrl: true,
          },
        },
      },
    });
  }

  async createProvider(
    userId: string,
    data: {
      type: ProviderType;
      businessName?: string;
      phone: string;
      whatsapp?: string;
      bio?: string;
      publicProfileUrl?: string;
    },
  ): Promise<Provider> {
    return prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: userId },
        data: { role: UserRole.PROVIDER },
      });

      return tx.provider.create({
        data: {
          userId,
          type: data.type,
          businessName: data.businessName,
          phone: data.phone,
          whatsapp: data.whatsapp,
          bio: data.bio,
          publicProfileUrl: data.publicProfileUrl,
        },
      });
    });
  }

  async updateProvider(id: string, data: Partial<Provider>): Promise<Provider> {
    return prisma.provider.update({
      where: { id },
      data,
    });
  }

  async createVerification(data: {
    providerId: string;
    documentType: string;
    documentUrl: string;
  }): Promise<Verification> {
    return prisma.$transaction(async (tx) => {
      await tx.provider.update({
        where: { id: data.providerId },
        data: { verificationStatus: VerificationStatus.PENDING },
      });

      return tx.verification.create({
        data: {
          providerId: data.providerId,
          documentType: data.documentType,
          documentUrl: data.documentUrl,
          status: VerificationStatus.PENDING,
        },
      });
    });
  }
}

export const providerRepository = new ProviderRepository();
