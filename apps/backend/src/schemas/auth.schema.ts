import { z } from "zod";

export const telegramAuthSchema = z.object({
  initData: z.string().min(1, "initData string is required"),
});

export type TelegramAuthInput = z.infer<typeof telegramAuthSchema>;
