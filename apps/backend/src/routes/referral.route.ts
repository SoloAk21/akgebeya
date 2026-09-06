import { Router } from "express";
import {
  getReferralCode,
  applyReferral,
  getReferralDashboard,
} from "../controllers/referral.controller";
import { authenticate } from "../middlewares/auth.middleware";

const router = Router();

router.get("/referrals/code", authenticate, getReferralCode);
router.post("/referrals/apply", authenticate, applyReferral);
router.get("/referrals/dashboard", authenticate, getReferralDashboard);

export default router;
