import { Request, Response } from "express";
import {
  createProviderSchema,
  submitVerificationSchema,
} from "../schemas/provider.schema";
import { providerService } from "../services/provider.service";

export const registerProvider = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ status: "error", message: "Unauthorized" });
      return;
    }

    const parseResult = createProviderSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({
        status: "error",
        message: "Validation failure",
        errors: parseResult.error.flatten(),
      });
      return;
    }

    const provider = await providerService.registerProvider(
      req.user.id,
      parseResult.data,
    );

    res.status(201).json({
      status: "success",
      data: { provider },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Registration failed";
    res.status(400).json({ status: "error", message });
  }
};

export const getProviderProfile = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ status: "error", message: "Unauthorized" });
      return;
    }

    const provider = await providerService.getProviderProfile(req.user.id);
    if (!provider) {
      res
        .status(404)
        .json({ status: "error", message: "Provider profile not found" });
      return;
    }

    res.status(200).json({
      status: "success",
      data: { provider },
    });
  } catch {
    res
      .status(500)
      .json({ status: "error", message: "Failed to fetch provider profile" });
  }
};

export const submitVerification = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ status: "error", message: "Unauthorized" });
      return;
    }

    const parseResult = submitVerificationSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({
        status: "error",
        message: "Validation failure",
        errors: parseResult.error.flatten(),
      });
      return;
    }

    const verification = await providerService.submitVerification(
      req.user.id,
      parseResult.data,
    );

    res.status(200).json({
      status: "success",
      message: "Verification document submitted successfully",
      data: { verification },
    });
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Verification submission failed";
    res.status(400).json({ status: "error", message });
  }
};

export const getPublicProfile = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const rawParam = req.params.profileUrl;
    const profileUrl = Array.isArray(rawParam) ? rawParam[0] : rawParam;

    if (!profileUrl) {
      res
        .status(400)
        .json({ status: "error", message: "Profile URL is required" });
      return;
    }

    const provider = await providerService.getPublicProfile(profileUrl);

    if (!provider) {
      res.status(404).json({ status: "error", message: "Provider not found" });
      return;
    }

    res.status(200).json({
      status: "success",
      data: { provider },
    });
  } catch {
    res
      .status(500)
      .json({ status: "error", message: "Failed to fetch public profile" });
  }
};
