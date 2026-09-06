import { Router } from "express";
import {
  createInquiry,
  getProviderInquiries,
  updateInquiryStatus,
} from "../controllers/inquiry.controller";
import { authenticate } from "../middlewares/auth.middleware";
import { requireRole } from "../middlewares/role.middleware";
import { UserRole } from "@prisma/client";

const router = Router();

router.post("/inquiries", authenticate, createInquiry);

router.get(
  "/crm/inquiries",
  authenticate,
  requireRole(UserRole.PROVIDER, UserRole.ADMIN),
  getProviderInquiries,
);

router.patch(
  "/crm/inquiries/:id",
  authenticate,
  requireRole(UserRole.PROVIDER, UserRole.ADMIN),
  updateInquiryStatus,
);

export default router;
