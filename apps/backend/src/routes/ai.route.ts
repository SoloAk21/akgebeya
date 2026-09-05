import { Router } from "express";
import {
  generateListingContent,
  parseSearchQuery,
} from "../controllers/ai.controller";
import { authenticate } from "../middlewares/auth.middleware";

const router = Router();

router.post("/ai/generate-listing", authenticate, generateListingContent);
router.post("/ai/parse-search", parseSearchQuery);

export default router;
