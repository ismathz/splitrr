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
  /** For optional `t.me/<bot>/<app>?startapp=` links in group messages. */
  TELEGRAM_BOT_USERNAME: z.string().min(1).optional(),
  TELEGRAM_MINI_APP_SHORT_NAME: z.string().min(1).optional()
});

export const env = envSchema.parse(process.env);
