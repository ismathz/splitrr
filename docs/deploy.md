# Deploy Notes

## GitHub Actions → Hostinger VPS (production)

Production is **Bun + systemd --user**, not Docker. Workflow: `.github/workflows/deploy-vps.yml`.
It runs after **CI** succeeds on a **push to `main`**, or via **`workflow_dispatch`**. It never deploys from PRs.

### Actions secrets (exact names)

| Secret | Example / notes |
| --- | --- |
| `VPS_HOST` | `76.13.222.104` |
| `VPS_USER` | `ismath` |
| `VPS_SSH_PRIVATE_KEY` | CI→VPS private key (PEM). **Do not commit.** |
| `VPS_SSH_PORT` | Optional; default `22` |

### One-time VPS setup (before first auto-deploy)

1. **Actions pubkey → `authorized_keys`**  
   Append the public half of `VPS_SSH_PRIVATE_KEY` to `~ismath/.ssh/authorized_keys`.

2. **Git remote must use the deploy key** (host alias `github.com-splitbot` → `~/.ssh/splitbot_deploy`):
   ```bash
   # ~/.ssh/config excerpt (already expected on the VPS):
   # Host github.com-splitbot
   #   HostName github.com
   #   User git
   #   IdentityFile ~/.ssh/splitbot_deploy
   #   IdentitiesOnly yes

   cd ~/apps/splitbot
   git remote -v
   # If origin still uses github.com, retarget:
   git remote set-url origin git@github.com-splitbot:ismathz/splitbot.git
   # Or one-shot: GIT_SSH_COMMAND='ssh -i ~/.ssh/splitbot_deploy -o IdentitiesOnly=yes' git fetch
   ```

### Redeploy recipe (verified)

Always sets `XDG_RUNTIME_DIR` (required for non-interactive `systemctl --user`).  
Uses VPS Bun at `~/.bun/bin` (currently 1.4.2). Does **not** overwrite `.env`. Does **not** restart `cloudflared-splitbot`.

```bash
export XDG_RUNTIME_DIR=/run/user/$(id -u)
export PATH="$HOME/.bun/bin:$PATH"
cd "$HOME/apps/splitbot"
git fetch origin main && git reset --hard origin/main
bun install
cd apps/miniapp
VITE_SPLITBOT_API=https://splitrr.ismath.dev \
VITE_BOT_MINIAPP_API=https://splitrr.ismath.dev \
bun run build
cd ../..
systemctl --user restart splitbot-api splitbot-bot splitbot-static
systemctl --user is-active splitbot-api splitbot-bot splitbot-static
```

Optional smoke: `curl -fsS https://splitrr.ismath.dev/health`

Units restarted: `splitbot-api` (:3000), `splitbot-bot` (:3001), `splitbot-static` (:8787).  
Public URL: https://splitrr.ismath.dev (Cloudflare Tunnel via `cloudflared-splitbot`).

## VPS Layout
- `apps/api` running as systemd service on port `3000`
- `apps/bot` webhook server on port `3001`
- `splitbot-static` serves the Mini App build on port `8787`
- Cloudflare Tunnel (`cloudflared-splitbot`) exposes https://splitrr.ismath.dev
- SQLite DB path on persistent volume, e.g. `/var/lib/splitbot/splitbot.db`
- Cloudflare R2 credentials set in env (`S3_*`) and validated on API startup
- Production env: `NODE_ENV=production`, `SPLITBOT_DEV_AUTH_BYPASS` unset/false, `TELEGRAM_BOT_TOKEN` set
- Runtime `.env` on the VPS is operator-managed; deploys must not overwrite it

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
