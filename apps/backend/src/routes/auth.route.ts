import { Router } from "express";
import { telegramAuth, getMe, logout } from "../controllers/auth.controller";
import { authenticate } from "../middlewares/auth.middleware";

const router = Router();

router.post("/auth/telegram", telegramAuth);
router.get("/auth/me", authenticate, getMe);
router.post("/auth/logout", authenticate, logout);

export default router;
