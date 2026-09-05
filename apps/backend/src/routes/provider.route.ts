import { Router } from "express";
import {
  registerProvider,
  getProviderProfile,
  submitVerification,
  getPublicProfile,
} from "../controllers/provider.controller";
import { authenticate } from "../middlewares/auth.middleware";

const router = Router();

router.post("/providers/register", authenticate, registerProvider);
router.get("/providers/me", authenticate, getProviderProfile);
router.post("/providers/verify", authenticate, submitVerification);
router.get("/providers/public/:profileUrl", getPublicProfile);

export default router;
