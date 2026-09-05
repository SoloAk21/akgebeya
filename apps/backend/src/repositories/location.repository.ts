import { prisma } from "../lib/prisma";
import { Location } from "@prisma/client";

export class LocationRepository {
  async createLocation(data: {
    region: string;
    city: string;
    subCity?: string;
    woreda?: string;
    kebele?: string;
    neighborhood?: string;
    streetLandmark?: string;
    latitude: number;
    longitude: number;
  }): Promise<Location> {
    const location = await prisma.location.create({
      data: {
        region: data.region,
        city: data.city,
        subCity: data.subCity,
        woreda: data.woreda,
        kebele: data.kebele,
        neighborhood: data.neighborhood,
        streetLandmark: data.streetLandmark,
        latitude: data.latitude,
        longitude: data.longitude,
      },
    });

    try {
      await prisma.$executeRaw`
        UPDATE "Location"
        SET "geom" = ST_SetSRID(ST_MakePoint(${data.longitude}, ${data.latitude}), 4326)
        WHERE "id" = ${location.id}
      `;
    } catch {
      // Gracefully continue if PostGIS extension is not active in local DB
    }

    return location;
  }
}

export const locationRepository = new LocationRepository();
