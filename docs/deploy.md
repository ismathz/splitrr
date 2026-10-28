# Deploy Notes

## VPS Layout
- `apps/api` running as systemd service (or Docker) on port `3000`
- `apps/bot` webhook server on port `3001`
- reverse proxy (Caddy/Nginx) exposing HTTPS routes
- SQLite DB path on persistent volume, e.g. `/var/lib/splitbot/splitbot.db`
- Cloudflare R2 credentials set in env (`S3_*`) and validated on API startup
- Production env: `NODE_ENV=production`, `SPLITBOT_DEV_AUTH_BYPASS` unset/false, `TELEGRAM_BOT_TOKEN` set

## Telegram webhook
Register the webhook (path includes secret; also pass the same value as `secret_token`):

```bash
curl -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook" \
  -H 'Content-Type: application/json' \
  -d "{\"url\":\"https://<host>/webhook/${TELEGRAM_WEBHOOK_SECRET}\",\"secret_token\":\"${TELEGRAM_WEBHOOK_SECRET}\"}"
```

Point BotFather Mini App URL at the HTTPS Mini App origin (`TELEGRAM_WEBAPP_URL`).

## Mini App build
Bake API bases at image build time:

```bash
VITE_SPLITBOT_API=https://api.example.com \
VITE_BOT_MINIAPP_API=https://bot.example.com \
  docker compose -f .build/compose.yml build miniapp
```

## Auth
- Mini App sends `X-Telegram-Init-Data` on every API call; API verifies Telegram HMAC + `auth_date`.
- Reminders: `POST /api/reminders/run` with header `X-Cron-Secret: $REMINDER_CRON_SECRET`.

## Nightly Backup
- Schedule cron:
  - `0 2 * * * /opt/splitbot/scripts/nightly-backup.sh >> /var/log/splitbot-backup.log 2>&1`
- Script uses `sqlite3 .backup` + `zstd`, then `aws s3 cp` (or `rclone`) to `BACKUP_BUCKET`
- Requires `aws` CLI **or** `rclone`, plus S3/`BACKUP_S3_*` credentials
- Retention policy: 30 daily / 12 weekly / 12 monthly

## Restore drill
```bash
# Download a backup object locally, then:
BACKUP_ARCHIVE=/path/to/backup.sqlite3.zst ./scripts/restore-drill.sh
```
Run monthly in staging.

## R2 Lifecycle Recommendations
- Keep receipt bucket private; serve files with signed URLs only
- Configure lifecycle rules:
  - `receipts/*/original/*` -> delete after 90 days
  - `receipts/*/compressed/*` -> delete after 180 days
- Keep env-separated prefixes via `S3_KEY_PREFIX` (e.g., `receipts/prod`)
