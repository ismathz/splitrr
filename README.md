# Splitbot

Telegram Bill Splitter built with Bun + TypeScript.

## Quick Start

1. Install dependencies: `bun install`
2. Copy env template: `cp .env.example .env`
3. Run services:
   - API: `bun run dev:api`
   - Bot: `bun run dev:bot`
   - Mini App: `bun run dev:miniapp`

## Architecture

### Components
- **Bot webhook (`apps/bot`)**: Receives Telegram updates, supports `/newbill`, `/history`, and receipt image intake in groups.
- **API (`apps/api`)**: Hono service for bill CRUD, OCR processing, assignments, settlement computation, reminders, and CSV export.
- **Mini App (`apps/miniapp`)**: Telegram Web App UI for receipt review, assignment, summary, and settlement screens.
- **SQLite (`bun:sqlite`)**: Core transactional data (`users`, `groups`, `bill_sessions`, `bill_items`, `item_assignments`, `charges`, `settlements`, `activity_events`, `schema_migrations`).
- **Object storage (Cloudflare R2)**: Stores receipt originals/compressed images via S3-compatible API, while SQLite stores metadata.
- **OpenAI OCR**: Vision parsing through structured JSON schema for receipt extraction.

### Receipt Flow
1. Group member runs `/newbill` in Telegram group.
2. Receipt photo is uploaded in group or Mini App.
3. Backend stores file in Cloudflare R2 (under `S3_KEY_PREFIX`) and tracks metadata in `receipt_images`.
4. OCR endpoint calls OpenAI Vision and writes parsed line-items into `bill_items` and extra fees into `charges`.
5. Members assign line-items via Mini App; assignments persist in `item_assignments`.
6. Settlement engine computes balances/transfers into `settlements`.
7. Reminder and history endpoints read from settlement/activity tables.

### VPS Deployment Shape
- Bun API process (port `3000`) and Bun bot webhook process (port `3001`).
- Reverse proxy (Nginx/Caddy) terminates TLS and routes to services.
- Persistent volume mounted for SQLite DB path (for example `/var/lib/splitbot/splitbot.db`).
- Environment variables for Telegram token/secret, OpenAI API key, and Cloudflare R2 S3-compatible credentials.
- API startup validates R2 bucket access (fail-fast on invalid credentials/bucket).

### Backup and Recovery
- Run nightly SQLite snapshot backup (`scripts/nightly-backup.sh`).
- Upload backup artifacts to off-VPS bucket (never same machine only).
- Suggested retention: 30 daily, 12 weekly, 12 monthly.
- Restore test cadence: monthly restore drill in staging.

### Receipt Lifecycle (R2)
- Keep bucket private and expose files only via short-lived signed URLs.
- Use lifecycle policy to auto-delete old originals (for example 90 days) and keep compressed assets longer (for example 180 days).
- Apply key prefixes by environment (`receipts/dev`, `receipts/staging`, `receipts/prod`) to simplify retention and cleanup.

### Security Controls
- Telegram webhook path includes a secret token (optional matching `X-Telegram-Bot-Api-Secret-Token` header).
- Mini App → API auth: `X-Telegram-Init-Data` verified with Telegram HMAC + `auth_date` freshness (`SPLITBOT_DEV_AUTH_BYPASS` for local only).
- Receipt objects are private and served through short-lived signed URLs; OCR uses owned storage keys only (no arbitrary `imageUrl`).
- Upload MIME/size validation and in-memory rate limits on receipt upload + OCR.
- Reminder cron protected by `REMINDER_CRON_SECRET`.
