import { Request, Response } from "express";
import { applyReferralCodeSchema } from "../schemas/referral.schema";
import { referralService } from "../services/referral.service";

export const getReferralCode = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ status: "error", message: "Unauthorized" });
      return;
    }

    const data = await referralService.getUserReferralCode(req.user.id);

    res.status(200).json({
      status: "success",
      data,
    });
  } catch {
    res
      .status(500)
      .json({ status: "error", message: "Failed to retrieve referral code" });
  }
};

export const applyReferral = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ status: "error", message: "Unauthorized" });
      return;
    }

    const parseResult = applyReferralCodeSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({
        status: "error",
        message: "Validation failure",
        errors: parseResult.error.flatten(),
      });
      return;
    }

    const referral = await referralService.applyReferralCode(
      req.user.id,
      parseResult.data,
    );

    res.status(201).json({
      status: "success",
      message: "Referral code claimed successfully",
      data: { referral },
    });
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Failed to apply referral code";
    res.status(400).json({ status: "error", message });
  }
};

export const getReferralDashboard = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ status: "error", message: "Unauthorized" });
      return;
    }

    const dashboard = await referralService.getReferralDashboard(req.user.id);

    res.status(200).json({
      status: "success",
      data: dashboard,
    });
  } catch {
    res
      .status(500)
      .json({ status: "error", message: "Failed to fetch referral dashboard" });
  }
};
