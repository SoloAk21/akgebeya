import { Router } from "express";
import {
  initializePayment,
  handleChapaWebhook,
} from "../controllers/payment.controller";
import { authenticate } from "../middlewares/auth.middleware";

const router = Router();

router.post("/payments/initialize", authenticate, initializePayment);
router.post("/payments/webhook/chapa", handleChapaWebhook);

export default router;
