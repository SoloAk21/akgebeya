import {
  listingRepository,
  ListingRepository,
} from "../repositories/listing.repository";
import {
  locationRepository,
  LocationRepository,
} from "../repositories/location.repository";
import {
  providerRepository,
  ProviderRepository,
} from "../repositories/provider.repository";
import {
  CreateListingInput,
  UpdateListingStatusInput,
  SearchListingInput,
} from "../schemas/listing.schema";
import { Listing } from "@prisma/client";

export class ListingService {
  constructor(
    private listingRepo: ListingRepository = listingRepository,
    private locationRepo: LocationRepository = locationRepository,
    private providerRepo: ProviderRepository = providerRepository,
  ) {}

  async createDraftListing(
    userId: string,
    input: CreateListingInput,
  ): Promise<Listing> {
    const provider = await this.providerRepo.findByUserId(userId);
    if (!provider) {
      throw new Error(
        "User must register as a provider before creating a listing",
      );
    }

    const location = await this.locationRepo.createLocation(input.location);

    const { location: _loc, ...listingData } = input;
    return this.listingRepo.createListing(
      provider.id,
      location.id,
      listingData,
    );
  }

  async getListingById(id: string): Promise<Listing | null> {
    return this.listingRepo.findById(id);
  }

  async updateListingStatus(
    userId: string,
    listingId: string,
    input: UpdateListingStatusInput,
  ): Promise<Listing> {
    const listing = await this.listingRepo.findById(listingId);
    if (!listing) {
      throw new Error("Listing not found");
    }

    const provider = await this.providerRepo.findByUserId(userId);
    if (!provider || provider.id !== listing.providerId) {
      throw new Error("Unauthorized to modify this listing");
    }

    return this.listingRepo.updateStatus(listingId, input.status);
  }

  async searchListings(
    filters: SearchListingInput,
  ): Promise<{ listings: Listing[]; total: number }> {
    return this.listingRepo.searchListings(filters);
  }
}

export const listingService = new ListingService();
