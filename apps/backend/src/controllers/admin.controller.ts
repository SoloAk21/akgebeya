import { Request, Response } from "express";
import {
  reportListingSchema,
  moderateListingSchema,
  reviewVerificationSchema,
} from "../schemas/admin.schema";
import { adminService } from "../services/admin.service";

export const reportListing = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const rawId = req.params.id;
    const listingId = Array.isArray(rawId) ? rawId[0] : rawId;

    if (!listingId) {
      res
        .status(400)
        .json({ status: "error", message: "Listing ID is required" });
      return;
    }

    const parseResult = reportListingSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({
        status: "error",
        message: "Validation failure",
        errors: parseResult.error.flatten(),
      });
      return;
    }

    const report = await adminService.reportListing(
      listingId,
      req.user?.id,
      parseResult.data,
    );

    res.status(201).json({
      status: "success",
      message:
        "Report submitted successfully. Thank you for keeping AkGebeya safe.",
      data: { report },
    });
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Failed to report listing";
    const statusCode = message === "Listing not found" ? 404 : 400;
    res.status(statusCode).json({ status: "error", message });
  }
};

export const getQuarantinedListings = async (
  _req: Request,
  res: Response,
): Promise<void> => {
  try {
    const listings = await adminService.getQuarantinedListings();

    res.status(200).json({
      status: "success",
      data: { listings },
    });
  } catch {
    res.status(500).json({
      status: "error",
      message: "Failed to fetch quarantined listings",
    });
  }
};

export const moderateListing = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const rawId = req.params.id;
    const listingId = Array.isArray(rawId) ? rawId[0] : rawId;

    if (!listingId) {
      res
        .status(400)
        .json({ status: "error", message: "Listing ID is required" });
      return;
    }

    const parseResult = moderateListingSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({
        status: "error",
        message: "Validation failure",
        errors: parseResult.error.flatten(),
      });
      return;
    }

    const listing = await adminService.moderateListing(
      listingId,
      parseResult.data,
    );

    res.status(200).json({
      status: "success",
      message: `Listing moderation completed: ${parseResult.data.action}`,
      data: { listing },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Moderation failed";
    const statusCode = message === "Listing not found" ? 404 : 400;
    res.status(statusCode).json({ status: "error", message });
  }
};

export const getPendingVerifications = async (
  _req: Request,
  res: Response,
): Promise<void> => {
  try {
    const verifications = await adminService.getPendingVerifications();

    res.status(200).json({
      status: "success",
      data: { verifications },
    });
  } catch {
    res.status(500).json({
      status: "error",
      message: "Failed to fetch pending verifications",
    });
  }
};

export const reviewVerification = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ status: "error", message: "Unauthorized" });
      return;
    }

    const rawId = req.params.id;
    const verificationId = Array.isArray(rawId) ? rawId[0] : rawId;

    if (!verificationId) {
      res
        .status(400)
        .json({ status: "error", message: "Verification ID is required" });
      return;
    }

    const parseResult = reviewVerificationSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({
        status: "error",
        message: "Validation failure",
        errors: parseResult.error.flatten(),
      });
      return;
    }

    const verification = await adminService.reviewVerification(
      verificationId,
      req.user.id,
      parseResult.data,
    );

    res.status(200).json({
      status: "success",
      message: `Verification review completed: ${parseResult.data.status}`,
      data: { verification },
    });
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Verification review failed";
    const statusCode =
      message === "Verification document not found" ? 404 : 400;
    res.status(statusCode).json({ status: "error", message });
  }
};
