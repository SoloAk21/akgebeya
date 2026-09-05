import { Request, Response, NextFunction } from "express";
import { UserRole } from "@prisma/client";
import { providerRepository } from "../repositories/provider.repository";

export const requireRole = (...roles: UserRole[]) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ status: "error", message: "Unauthorized" });
      return;
    }

    if (!roles.includes(req.user.role)) {
      res.status(403).json({
        status: "error",
        message: `Forbidden: requires one of the following roles: ${roles.join(", ")}`,
      });
      return;
    }

    next();
  };
};

export const requireVerifiedProvider = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  if (!req.user) {
    res.status(401).json({ status: "error", message: "Unauthorized" });
    return;
  }

  const provider = await providerRepository.findByUserId(req.user.id);

  if (!provider) {
    res.status(403).json({
      status: "error",
      message: "Forbidden: Provider profile not found",
    });
    return;
  }

  if (!provider.isVerified) {
    res.status(403).json({
      status: "error",
      message: "Forbidden: Provider profile is not verified",
    });
    return;
  }

  next();
};
