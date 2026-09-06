import { Router } from "express";
import { generateLeaseAgreement } from "../controllers/lease.controller";
import { authenticate } from "../middlewares/auth.middleware";

const router = Router();

router.post("/leases/generate", authenticate, generateLeaseAgreement);

export default router;
