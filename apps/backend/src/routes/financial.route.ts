import { Router } from "express";
import {
  getValuationEstimate,
  calculateMortgageEstimate,
} from "../controllers/financial.controller";

const router = Router();

router.post("/finance/valuation", getValuationEstimate);
router.post("/finance/mortgage", calculateMortgageEstimate);

export default router;
