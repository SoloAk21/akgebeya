import { Router } from "express";
import {
  createListing,
  getListing,
  updateListingStatus,
  searchListings,
} from "../controllers/listing.controller";
import { authenticate } from "../middlewares/auth.middleware";
import { requireRole } from "../middlewares/role.middleware";
import { UserRole } from "@prisma/client";

const router = Router();

router.post(
  "/listings",
  authenticate,
  requireRole(UserRole.PROVIDER, UserRole.ADMIN),
  createListing,
);
router.get("/listings/search", searchListings);
router.get("/listings/:id", getListing);
router.patch("/listings/:id/status", authenticate, updateListingStatus);

export default router;
