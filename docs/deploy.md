# Deploy Notes

## VPS Layout
- `apps/api` running as systemd service on port `3000`
- `apps/bot` webhook server on port `3001`
- reverse proxy (Caddy/Nginx) exposing HTTPS routes
- SQLite DB path on persistent volume, e.g. `/var/lib/splitbot/splitbot.db`
- Cloudflare R2 credentials set in env (`S3_*`) and validated on API startup

## Nightly Backup
- Schedule cron:
  - `0 2 * * * /opt/splitbot/scripts/nightly-backup.sh >> /var/log/splitbot-backup.log 2>&1`
- Upload DB snapshot to off-VPS S3 bucket
- Retention policy: 30 daily / 12 weekly / 12 monthly

## R2 Lifecycle Recommendations
- Keep receipt bucket private; serve files with signed URLs only
- Configure lifecycle rules:
  - `receipts/*/original/*` -> delete after 90 days
  - `receipts/*/compressed/*` -> delete after 180 days
- Keep env-separated prefixes via `S3_KEY_PREFIX` (e.g., `receipts/prod`)
