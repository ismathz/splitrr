import { config } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const __dirname = dirname(fileURLToPath(import.meta.url));
// Monorepo root first, then apps/api (later wins for duplicate keys).
config({ path: resolve(__dirname, "../../../.env") });
config({ path: resolve(__dirname, "../.env") });

const boolFromEnv = z
  .union([z.boolean(), z.string()])
  .optional()
  .transform((v) => {
    if (typeof v === "boolean") return v;
    if (v == null || v === "") return false;
    return ["1", "true", "yes", "on"].includes(String(v).toLowerCase());
  });

const envSchema = z
  .object({
    NODE_ENV: z.string().default("development"),
    PORT: z.coerce.number().default(3000),
    SQLITE_PATH: z.string().default("./data/splitbot.db"),
    /** OpenRouter API key (OpenAI-compatible). Preferred over any legacy OpenAI key. */
    OPENROUTER_API_KEY: z.string().min(1),
    /** OpenAI-compatible base URL (default OpenRouter). */
    OPENROUTER_BASE_URL: z
      .string()
      .url()
      .default("https://openrouter.ai/api/v1"),
    /** Vision-capable model id on OpenRouter (provider/model). */
    OPENROUTER_MODEL: z.string().default("openai/gpt-4o-mini"),

    S3_BUCKET: z.string().min(1),
    S3_ENDPOINT: z.string().url(),
    S3_REGION: z.string().default("auto"),
    S3_ACCESS_KEY_ID: z.string().min(1),
    S3_SECRET_ACCESS_KEY: z.string().min(1),
    S3_KEY_PREFIX: z.string().default("receipts"),
    TELEGRAM_BOT_TOKEN: z
      .string()
      .min(1)
      .optional()
      .transform((v) =>
        v == null ? v : v.trim().replace(/^["']|["']$/g, "")
      ),
    TELEGRAM_WEBAPP_URL: z.string().url().optional(),
    /** Bot username without `@` for announce deep links (default @SplitrrBot). */
    TELEGRAM_BOT_USERNAME: z.string().min(1).default("SplitrrBot"),
    /** BotFather Mini App short name for announce deep links. */
    TELEGRAM_MINI_APP_SHORT_NAME: z.string().min(1).default("app"),
    /** Allow unauthenticated API calls (local Mini App / curl only). */
    SPLITBOT_DEV_AUTH_BYPASS: boolFromEnv,
    /** Shared secret for POST /api/reminders/run */
    REMINDER_CRON_SECRET: z.string().min(8).optional(),
    BACKUP_BUCKET: z.string().optional(),
    BACKUP_PREFIX: z.string().default("backups/splitbot/dev")
  })
  .superRefine((val, ctx) => {
    const isProd = val.NODE_ENV === "production";
    if (isProd && !val.TELEGRAM_BOT_TOKEN) {
      ctx.addIssue({
        code: "custom",
        path: ["TELEGRAM_BOT_TOKEN"],
        message: "TELEGRAM_BOT_TOKEN is required in production"
      });
    }
    if (isProd && val.SPLITBOT_DEV_AUTH_BYPASS) {
      ctx.addIssue({
        code: "custom",
        path: ["SPLITBOT_DEV_AUTH_BYPASS"],
        message: "SPLITBOT_DEV_AUTH_BYPASS must be false in production"
      });
    }
    if (!val.SPLITBOT_DEV_AUTH_BYPASS && !val.TELEGRAM_BOT_TOKEN) {
      ctx.addIssue({
        code: "custom",
        path: ["TELEGRAM_BOT_TOKEN"],
        message:
          "TELEGRAM_BOT_TOKEN is required unless SPLITBOT_DEV_AUTH_BYPASS=true"
      });
    }
  });

export const env = envSchema.parse(process.env);
