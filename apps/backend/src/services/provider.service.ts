import {
  providerRepository,
  ProviderRepository,
} from "../repositories/provider.repository";
import {
  CreateProviderInput,
  SubmitVerificationInput,
} from "../schemas/provider.schema";
import { Provider, Verification } from "@prisma/client";

export class ProviderService {
  constructor(private providerRepo: ProviderRepository = providerRepository) {}

  async registerProvider(
    userId: string,
    input: CreateProviderInput,
  ): Promise<Provider> {
    const existing = await this.providerRepo.findByUserId(userId);
    if (existing) {
      throw new Error("User already has a provider profile");
    }

    if (input.publicProfileUrl) {
      const existingUrl = await this.providerRepo.findByPublicProfileUrl(
        input.publicProfileUrl,
      );
      if (existingUrl) {
        throw new Error("Public profile URL is already taken");
      }
    }

    return this.providerRepo.createProvider(userId, input);
  }

  async getProviderProfile(userId: string): Promise<Provider | null> {
    return this.providerRepo.findByUserId(userId);
  }

  async submitVerification(
    userId: string,
    input: SubmitVerificationInput,
  ): Promise<Verification> {
    const provider = await this.providerRepo.findByUserId(userId);
    if (!provider) {
      throw new Error(
        "Provider profile required before verification submission",
      );
    }

    return this.providerRepo.createVerification({
      providerId: provider.id,
      documentType: input.documentType,
      documentUrl: input.documentUrl,
    });
  }

  async getPublicProfile(profileUrl: string): Promise<Provider | null> {
    return this.providerRepo.findByPublicProfileUrl(profileUrl);
  }
}

export const providerService = new ProviderService();
