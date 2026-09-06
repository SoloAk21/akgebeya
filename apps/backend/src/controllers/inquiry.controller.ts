import { Request, Response } from "express";
import {
  createInquirySchema,
  updateInquiryStatusSchema,
} from "../schemas/inquiry.schema";
import { inquiryService } from "../services/inquiry.service";
import { InquiryStatus } from "@prisma/client";

export const createInquiry = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ status: "error", message: "Unauthorized" });
      return;
    }

    const parseResult = createInquirySchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({
        status: "error",
        message: "Validation failure",
        errors: parseResult.error.flatten(),
      });
      return;
    }

    const inquiry = await inquiryService.createInquiry(
      req.user.id,
      parseResult.data,
    );

    res.status(201).json({
      status: "success",
      message: "Inquiry submitted successfully to broker",
      data: { inquiry },
    });
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Failed to submit inquiry";
    const statusCode = message === "Listing not found" ? 404 : 400;
    res.status(statusCode).json({ status: "error", message });
  }
};

export const getProviderInquiries = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ status: "error", message: "Unauthorized" });
      return;
    }

    const rawStatus = req.query.status as string | undefined;
    const statusFilter =
      rawStatus &&
      Object.values(InquiryStatus).includes(rawStatus as InquiryStatus)
        ? (rawStatus as InquiryStatus)
        : undefined;

    const inquiries = await inquiryService.getProviderInquiries(
      req.user.id,
      statusFilter,
    );

    res.status(200).json({
      status: "success",
      data: { inquiries },
    });
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Failed to fetch CRM inquiries";
    res.status(400).json({ status: "error", message });
  }
};

export const updateInquiryStatus = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ status: "error", message: "Unauthorized" });
      return;
    }

    const rawId = req.params.id;
    const inquiryId = Array.isArray(rawId) ? rawId[0] : rawId;

    if (!inquiryId) {
      res
        .status(400)
        .json({ status: "error", message: "Inquiry ID is required" });
      return;
    }

    const parseResult = updateInquiryStatusSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({
        status: "error",
        message: "Validation failure",
        errors: parseResult.error.flatten(),
      });
      return;
    }

    const inquiry = await inquiryService.updateInquiryStatus(
      req.user.id,
      inquiryId,
      parseResult.data,
    );

    res.status(200).json({
      status: "success",
      message: `Inquiry pipeline status updated to ${parseResult.data.status}`,
      data: { inquiry },
    });
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Failed to update CRM inquiry";
    const statusCode = message === "Inquiry not found" ? 404 : 400;
    res.status(statusCode).json({ status: "error", message });
  }
};
