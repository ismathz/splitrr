import { config } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const __dirname = dirname(fileURLToPath(import.meta.url));
// Same load order as apps/api: monorepo root first, then apps/bot (later wins).
config({ path: resolve(__dirname, "../../../.env") });
config({ path: resolve(__dirname, "../.env") });

const envSchema = z.object({
  BOT_PORT: z.coerce.number().default(3001),
  /** From https://my.telegram.org/apps — required for mtcute MTProto. */
  TELEGRAM_API_ID: z.coerce.number().int().positive(),
  TELEGRAM_API_HASH: z.string().min(1),
  TELEGRAM_BOT_TOKEN: z
    .string()
    .min(1)
    .transform((v) => v.trim().replace(/^["']|["']$/g, "")),
  TELEGRAM_WEBHOOK_SECRET: z.string().min(1),
  TELEGRAM_WEBAPP_URL: z.string().url(),
  /** Prefer an absolute path shared with the API (see docs/deploy.md). */
  SQLITE_PATH: z
    .string()
    .default("./data/splitbot.db")
    .transform((v) => resolve(v)),
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
