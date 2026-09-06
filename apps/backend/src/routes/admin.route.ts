import { Router } from "express";
import {
  reportListing,
  getQuarantinedListings,
  moderateListing,
  getPendingVerifications,
  reviewVerification,
} from "../controllers/admin.controller";
import { authenticate } from "../middlewares/auth.middleware";
import { requireRole } from "../middlewares/role.middleware";
import { UserRole } from "@prisma/client";

const router = Router();

router.post("/listings/:id/report", reportListing);

router.get(
  "/admin/listings/quarantined",
  authenticate,
  requireRole(UserRole.ADMIN),
  getQuarantinedListings,
);

router.patch(
  "/admin/listings/:id/moderation",
  authenticate,
  requireRole(UserRole.ADMIN),
  moderateListing,
);

router.get(
  "/admin/providers/pending-verifications",
  authenticate,
  requireRole(UserRole.ADMIN),
  getPendingVerifications,
);

router.patch(
  "/admin/verifications/:id/review",
  authenticate,
  requireRole(UserRole.ADMIN),
  reviewVerification,
);

export default router;
