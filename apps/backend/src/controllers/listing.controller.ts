import { Request, Response } from "express";
import {
  createListingSchema,
  updateListingStatusSchema,
  searchListingSchema,
} from "../schemas/listing.schema";
import { listingService } from "../services/listing.service";

export const createListing = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ status: "error", message: "Unauthorized" });
      return;
    }

    const parseResult = createListingSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({
        status: "error",
        message: "Validation failure",
        errors: parseResult.error.flatten(),
      });
      return;
    }

    const listing = await listingService.createDraftListing(
      req.user.id,
      parseResult.data,
    );

    res.status(201).json({
      status: "success",
      data: { listing },
    });
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Failed to create listing";
    res.status(400).json({ status: "error", message });
  }
};

export const getListing = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const rawId = req.params.id;
    const id = Array.isArray(rawId) ? rawId[0] : rawId;

    if (!id) {
      res
        .status(400)
        .json({ status: "error", message: "Listing ID is required" });
      return;
    }

    const listing = await listingService.getListingById(id);
    if (!listing) {
      res.status(404).json({ status: "error", message: "Listing not found" });
      return;
    }

    res.status(200).json({
      status: "success",
      data: { listing },
    });
  } catch {
    res
      .status(500)
      .json({ status: "error", message: "Failed to retrieve listing" });
  }
};

export const updateListingStatus = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ status: "error", message: "Unauthorized" });
      return;
    }

    const rawId = req.params.id;
    const listingId = Array.isArray(rawId) ? rawId[0] : rawId;

    if (!listingId) {
      res
        .status(400)
        .json({ status: "error", message: "Listing ID is required" });
      return;
    }

    const parseResult = updateListingStatusSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({
        status: "error",
        message: "Validation failure",
        errors: parseResult.error.flatten(),
      });
      return;
    }

    const listing = await listingService.updateListingStatus(
      req.user.id,
      listingId,
      parseResult.data,
    );

    res.status(200).json({
      status: "success",
      data: { listing },
    });
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Failed to update status";
    res.status(400).json({ status: "error", message });
  }
};

export const searchListings = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const parseResult = searchListingSchema.safeParse(req.query);
    if (!parseResult.success) {
      res.status(400).json({
        status: "error",
        message: "Validation failure",
        errors: parseResult.error.flatten(),
      });
      return;
    }

    const { listings, total } = await listingService.searchListings(
      parseResult.data,
    );

    res.status(200).json({
      status: "success",
      data: {
        listings,
        pagination: {
          total,
          page: parseResult.data.page,
          limit: parseResult.data.limit,
          totalPages: Math.ceil(total / parseResult.data.limit),
        },
      },
    });
  } catch {
    res
      .status(500)
      .json({ status: "error", message: "Failed to search listings" });
  }
};
