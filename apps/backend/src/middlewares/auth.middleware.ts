import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { env } from "../config/env.config";
import { sessionRepository } from "../repositories/session.repository";
import { userRepository } from "../repositories/user.repository";

interface JwtPayload {
  userId: string;
  role: string;
}

export const authenticate = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      res
        .status(401)
        .json({ status: "error", message: "Authentication required" });
      return;
    }

    const token = authHeader.split(" ")[1];
    const decoded = jwt.verify(token, env.JWT_SECRET) as JwtPayload;

    const activeSession = await sessionRepository.findActiveSession(token);
    if (!activeSession) {
      res
        .status(401)
        .json({ status: "error", message: "Session expired or revoked" });
      return;
    }

    const user = await userRepository.findById(decoded.userId);
    if (!user || !user.isActive) {
      res.status(401).json({
        status: "error",
        message: "User account inactive or suspended",
      });
      return;
    }

    req.user = user;
    req.token = token;
    next();
  } catch {
    res.status(401).json({
      status: "error",
      message: "Invalid or expired authentication token",
    });
  }
};
