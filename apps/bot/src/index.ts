import { Telegraf, Markup } from "telegraf";
import { env } from "./config/env.config";

const bot = new Telegraf(env.TELEGRAM_BOT_TOKEN);

bot.use(async (ctx, next) => {
  const start = Date.now();
  await next();
  const ms = Date.now() - start;
  console.log(`[Bot Log] Processed update ${ctx.update.update_id} in ${ms}ms`);
});

bot.command("start", (ctx) => {
  const welcomeText =
    `✨ **Welcome to AkGebeya (አክገበያ)**\n\n` +
    `The premier Ethiopian real estate marketplace. Find verified homes, apartments, commercial properties, and land across Ethiopia.\n\n` +
    `👇 Click the button below to launch the AkGebeya Mini App:`;

  return ctx.reply(welcomeText, {
    parse_mode: "Markdown",
    ...Markup.inlineKeyboard([
      [Markup.button.webApp("🚀 Launch AkGebeya App", env.WEBAPP_URL)],
    ]),
  });
});

bot.command("help", (ctx) => {
  const helpText =
    `ℹ️ **AkGebeya Bot Commands**\n\n` +
    `/start - Launch AkGebeya Telegram Mini App\n` +
    `/help - Show help and instructions\n` +
    `/status - Check API connection status\n\n` +
    `For support or inquiries, visit the Mini App profile section.`;

  return ctx.reply(helpText, { parse_mode: "Markdown" });
});

bot.command("status", async (ctx) => {
  try {
    const res = await fetch(`${env.BACKEND_API_URL}/health`);
    const data = (await res.json()) as { status: string; message: string };

    if (data.status === "success") {
      return ctx.reply(`✅ Backend API Status: **Online**\n_${data.message}_`, {
        parse_mode: "Markdown",
      });
    }
    return ctx.reply(`⚠️ Backend API returned unexpected status.`);
  } catch {
    return ctx.reply(
      `❌ Failed to connect to Backend API at \`${env.BACKEND_API_URL}\``,
      { parse_mode: "Markdown" },
    );
  }
});

bot.catch((err, ctx) => {
  console.error(`[Bot Error] Error for ${ctx.updateType}`, err);
  ctx.reply(
    "An unexpected error occurred while processing your request. Please try again.",
  );
});

if (process.env.NODE_ENV !== "test") {
  bot
    .launch()
    .then(() => {
      console.log(
        "[AkGebeya Bot] Telegram Bot initialized and polling successfully.",
      );
    })
    .catch((err) => {
      console.warn(
        "[AkGebeya Bot] Notice: Could not authorize with Telegram servers. Set a valid TELEGRAM_BOT_TOKEN from @BotFather in apps/bot/.env to activate live polling.",
      );
      if (err?.response?.error_code !== 401) {
        console.error("[AkGebeya Bot] Error details:", err);
      }
    });

  process.once("SIGINT", () => bot.stop("SIGINT"));
  process.once("SIGTERM", () => bot.stop("SIGTERM"));
}
