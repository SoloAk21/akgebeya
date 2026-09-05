import { Request, Response } from "express";
import { telegramAuthSchema } from "../schemas/auth.schema";
import { authService } from "../services/auth.service";

export const telegramAuth = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const parseResult = telegramAuthSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({
        status: "error",
        message: "Validation failure",
        errors: parseResult.error.flatten(),
      });
      return;
    }

    const { user, token } = await authService.authenticateTelegram(
      parseResult.data.initData,
    );

    res.status(200).json({
      status: "success",
      data: {
        user: {
          id: user.id,
          fullName: user.fullName,
          role: user.role,
          language: user.language,
        },
        token,
      },
    });
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Authentication failed";
    res.status(401).json({ status: "error", message });
  }
};

export const getMe = async (req: Request, res: Response): Promise<void> => {
  if (!req.user) {
    res.status(401).json({ status: "error", message: "Unauthorized" });
    return;
  }

  res.status(200).json({
    status: "success",
    data: {
      user: {
        id: req.user.id,
        fullName: req.user.fullName,
        phone: req.user.phone,
        email: req.user.email,
        role: req.user.role,
        language: req.user.language,
      },
    },
  });
};

export const logout = async (req: Request, res: Response): Promise<void> => {
  if (req.token) {
    await authService.logout(req.token);
  }

  res.status(200).json({
    status: "success",
    message: "Successfully logged out",
  });
};
