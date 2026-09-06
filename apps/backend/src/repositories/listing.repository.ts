import { prisma } from "../lib/prisma";
import { Listing, ListingStatus, Prisma } from "@prisma/client";
import {
  CreateListingInput,
  SearchListingInput,
} from "../schemas/listing.schema";

export type ListingWithDetails = Prisma.ListingGetPayload<{
  include: {
    location: true;
    media: true;
    provider: {
      include: {
        user: {
          select: { fullName: true; avatarUrl: true };
        };
      };
    };
  };
}>;

export class ListingRepository {
  async createListing(
    providerId: string,
    locationId: string,
    data: Omit<CreateListingInput, "location">,
  ): Promise<Listing> {
    return prisma.listing.create({
      data: {
        providerId,
        locationId,
        titleEn: data.titleEn,
        titleAm: data.titleAm,
        descriptionEn: data.descriptionEn,
        descriptionAm: data.descriptionAm,
        category: data.category,
        transaction: data.transaction,
        propertyType: data.propertyType,
        price: data.price,
        areaSqM: data.areaSqM,
        bedrooms: data.bedrooms,
        bathrooms: data.bathrooms,
        condition: data.condition,
        amenities: data.amenities,
        status: ListingStatus.DRAFT,
      },
      include: {
        location: true,
        provider: true,
      },
    });
  }

  async findById(id: string): Promise<ListingWithDetails | null> {
    return prisma.listing.findUnique({
      where: { id },
      include: {
        location: true,
        media: {
          orderBy: { order: "asc" },
        },
        provider: {
          include: {
            user: {
              select: { fullName: true, avatarUrl: true },
            },
          },
        },
      },
    });
  }

  async updateStatus(id: string, status: ListingStatus): Promise<Listing> {
    const updateData: Prisma.ListingUpdateInput = { status };
    if (status === ListingStatus.PUBLISHED) {
      updateData.publishedAt = new Date();
      const expiration = new Date();
      expiration.setDate(expiration.getDate() + 30);
      updateData.expiresAt = expiration;
    }

    return prisma.listing.update({
      where: { id },
      data: updateData,
      include: { location: true },
    });
  }

  async searchListings(
    filters: SearchListingInput,
  ): Promise<{ listings: Listing[]; total: number }> {
    const where: Prisma.ListingWhereInput = {
      isQuarantined: false,
    };

    if (filters.category) where.category = filters.category;
    if (filters.transaction) where.transaction = filters.transaction;
    if (filters.propertyType) where.propertyType = filters.propertyType;
    if (filters.bedrooms !== undefined)
      where.bedrooms = { gte: filters.bedrooms };
    if (filters.bathrooms !== undefined)
      where.bathrooms = { gte: filters.bathrooms };

    if (filters.minPrice !== undefined || filters.maxPrice !== undefined) {
      where.price = {};
      if (filters.minPrice !== undefined) where.price.gte = filters.minPrice;
      if (filters.maxPrice !== undefined) where.price.lte = filters.maxPrice;
    }

    if (filters.city || filters.subCity) {
      where.location = {};
      if (filters.city)
        where.location.city = { contains: filters.city, mode: "insensitive" };
      if (filters.subCity)
        where.location.subCity = {
          contains: filters.subCity,
          mode: "insensitive",
        };
    }

    if (filters.latitude !== undefined && filters.longitude !== undefined) {
      const radiusMeters = filters.radiusKm * 1000;
      try {
        const nearbyLocations: Array<{ id: string }> = await prisma.$queryRaw`
          SELECT "id" FROM "Location"
          WHERE ST_DWithin(
            "geom"::geography,
            ST_SetSRID(ST_MakePoint(${filters.longitude}, ${filters.latitude}), 4326)::geography,
            ${radiusMeters}
          )
        `;
        const locationIds = nearbyLocations.map((l) => l.id);
        where.locationId = { in: locationIds };
      } catch {
        // Fallback if PostGIS spatial index is not present
      }
    }

    const skip = (filters.page - 1) * filters.limit;

    const [listings, total] = await Promise.all([
      prisma.listing.findMany({
        where,
        skip,
        take: filters.limit,
        orderBy: { createdAt: "desc" },
        include: {
          location: true,
          media: { take: 1 },
        },
      }),
      prisma.listing.count({ where }),
    ]);

    return { listings, total };
  }
}

export const listingRepository = new ListingRepository();
