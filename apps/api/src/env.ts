import { config } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const __dirname = dirname(fileURLToPath(import.meta.url));
// Monorepo root first, then apps/api (later wins for duplicate keys).
config({ path: resolve(__dirname, "../../../.env") });
config({ path: resolve(__dirname, "../.env") });

const envSchema = z.object({
  NODE_ENV: z.string().default("development"),
  PORT: z.coerce.number().default(3000),
  SQLITE_PATH: z.string().default("./data/splitbot.db"),
  OPENAI_API_KEY: z.string().min(1),
  OPENAI_MODEL: z.string().default("gpt-4.1-mini"),
  S3_BUCKET: z.string().min(1),
  S3_ENDPOINT: z.string().url(),
  S3_REGION: z.string().default("auto"),
  S3_ACCESS_KEY_ID: z.string().min(1),
  S3_SECRET_ACCESS_KEY: z.string().min(1),
  S3_KEY_PREFIX: z.string().default("receipts"),
  TELEGRAM_BOT_TOKEN: z.string().optional(),
  BACKUP_BUCKET: z.string().optional(),
  BACKUP_PREFIX: z.string().default("backups/splitbot/dev")
});

export const env = envSchema.parse(process.env);
