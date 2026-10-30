import { z } from "zod";

const envSchema = z.object({
  BOT_PORT: z.coerce.number().default(3001),
  /** From https://my.telegram.org/apps — required for mtcute MTProto. */
  TELEGRAM_API_ID: z.coerce.number().int().positive(),
  TELEGRAM_API_HASH: z.string().min(1),
  TELEGRAM_BOT_TOKEN: z.string().min(1),
  TELEGRAM_WEBHOOK_SECRET: z.string().min(1),
  TELEGRAM_WEBAPP_URL: z.string().url(),
  SQLITE_PATH: z.string().default("./data/splitbot.db"),
  /**
   * Bot username without `@` for `t.me/<user>/<app>?startapp=` group deep links.
   * Default matches production @SplitrrBot.
   */
  TELEGRAM_BOT_USERNAME: z.string().min(1).default("SplitrrBot"),
  /**
   * BotFather Mini App short name (path segment in the deep link).
   * Must match the short name configured in BotFather; override via env if not `app`.
   */
  TELEGRAM_MINI_APP_SHORT_NAME: z.string().min(1).default("app")
});

export const env = envSchema.parse(process.env);
