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

### VPS git / deploy-key status (verified)

- `origin` is `git@github.com-splitbot:ismathz/splitbot.git` — `git fetch origin main` works.
- Deploy key `splitbot-deploy@srv1495393` is on the GitHub repo (read-only).
- Checkout on the VPS is **behind** `origin/main`; the first deploy’s `git reset --hard origin/main` will move it forward.

### Still required before first auto-deploy

**Actions pubkey → `authorized_keys`** (out of band): append the public half of `VPS_SSH_PRIVATE_KEY` to `~ismath/.ssh/authorized_keys`. Auto-deploy cannot SSH in until this is done.

### `git reset --hard` — intentional discard of local mods

The deploy recipe runs `git fetch origin main && git reset --hard origin/main`.

| Path | Survives reset? | Notes |
| --- | --- | --- |
| Modified **tracked** files on the VPS | **No — discarded on purpose** | VPS Admin reported a dirty tree; first deploy will wipe those local edits so the box matches `main`. Do not keep prod-only fixes only as uncommitted VPS edits. |
| Untracked `data/` (SQLite) | **Yes** | `data/` is in `.gitignore`; `reset --hard` does not remove untracked files. Deploy never runs `git clean`. |
| Untracked `.env` | **Yes** | `.env` / `.env.*` are gitignored; deploy never overwrites `.env`. |
| `cloudflared-splitbot` | N/A | Never restarted by this workflow. |

If you need to preserve a local VPS edit, commit it on a branch or copy it aside **before** the first auto-deploy.

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

Optional smoke: `curl -fsS https://splitrr.ismath.dev/api/health`  
(Bare `/health` is often the **bot** `{ok:true}` via the tunnel — use `/api/health` for API + Telegram token fingerprint.)

Units restarted: `splitbot-api` (:3000), `splitbot-bot` (:3001), `splitbot-static` (:8787).  
Public URL: https://splitrr.ismath.dev (Cloudflare Tunnel via `cloudflared-splitbot`).

## VPS Layout
- `apps/api` running as systemd service on port `3000`
- `apps/bot` webhook server on port `3001`
- `splitbot-static` serves the Mini App build on port `8787`
- Cloudflare Tunnel (`cloudflared-splitbot`) exposes https://splitrr.ismath.dev
- SQLite DB path on persistent volume, e.g. `/var/lib/splitbot/splitbot.db`
- Cloudflare R2 credentials set in env (`S3_*`) and validated on API startup (`HeadBucket`)
- Required for receipt scan: `OPENAI_API_KEY` **with usable credit/quota**, `OPENAI_MODEL` (default `gpt-4.1-mini`), and full `S3_*` set
- Dig: `curl -fsS https://splitrr.ismath.dev/api/health` (shows `openai.keyConfigured` / `storage.bucket`) and `curl -fsS https://splitrr.ismath.dev/api/pipeline/last-failures`
- If dig shows `openaiCode: credit_balance_exhausted` / `openai_quota_exhausted`: top up OpenAI billing for that key (not a Splitbot rate-limit).
- Production env: `NODE_ENV=production`, `SPLITBOT_DEV_AUTH_BYPASS` unset/false, `TELEGRAM_BOT_TOKEN` set
- Runtime `.env` on the VPS is operator-managed; deploys must not overwrite it

## Telegram webhook
Register the webhook (path includes secret; also pass the same value as `secret_token`):

```bash
curl -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook" \
  -H 'Content-Type: application/json' \
  -d "{\"url\":\"https://<host>/webhook/${TELEGRAM_WEBHOOK_SECRET}\",\"secret_token\":\"${TELEGRAM_WEBHOOK_SECRET}\"}"
```

Point BotFather Mini App URL at the HTTPS Mini App origin (`TELEGRAM_WEBAPP_URL`, production: `https://splitrr.ismath.dev`).

### BotFather + deep-link env (required for `/split` in groups)

| Env (VPS `.env`, bot + API) | Example | Notes |
| --- | --- | --- |
| `TELEGRAM_BOT_USERNAME` | `SplitrrBot` | No `@`. Defaults to `SplitrrBot` if unset. |
| `TELEGRAM_MINI_APP_SHORT_NAME` | `app` | Must match BotFather Mini App **short name** (path in `t.me/SplitrrBot/<short_name>`). Defaults to `app`; set explicitly if BotFather uses another name. |

BotFather checklist:
1. Mini App URL = `https://splitrr.ismath.dev` — note the short name.
2. `/setcommands` (groups + default): `split`, `history`, `help` — remove `newbill`.
3. Menu Button → same Mini App URL.
4. Restart bot/API after changing `.env` (deploy does not overwrite `.env`).
5. **Group roster fill:** Telegram Bot API cannot list all members. Splitbot stores who it can see (admins via `/split` + API-side admin backfill on Mini App open, join/leave, command/message senders, Mini App openers). For a fuller roster, either disable privacy mode (`/setprivacy` → Disable) **or** make the bot a group admin so it sees ordinary messages. No new env vars required for roster.
6. **Shared SQLite:** `SQLITE_PATH` must be the **same absolute path** for `splitbot-api` and `splitbot-bot` (e.g. `/var/lib/splitbot/splitbot.db`). Relative `./data/splitbot.db` under different working directories creates two DBs and the Mini App will not see bot-side roster writes.

## Mini App build
Bake API bases at Vite build time (same as the VPS redeploy recipe):

```bash
cd apps/miniapp
VITE_SPLITBOT_API=https://api.example.com \
VITE_BOT_MINIAPP_API=https://bot.example.com \
  bun run build
```

## Auth
- Mini App sends Telegram `initData` via `Authorization: tma …`, `X-Telegram-Init-Data`, FormData, and query fallback.
- HMAC: `secret_key = HMAC-SHA256(key="WebAppData", msg=bot_token)`, then hex HMAC of the data-check-string. **Exclude only `hash` from the check string — include `signature` when present** (modern clients always send Ed25519 `signature` next to HMAC `hash`; matching `@telegram-apps/init-data-node`).
- Live marker: `curl -fsS https://splitrr.ismath.dev/api/health` → `hmacAlgo` should be `WebAppData-as-key-v2-include-signature`.
- Temporary dig (no secrets): `curl -fsS https://splitrr.ismath.dev/api/auth/last-failures` → recent auth failure reasons + `hasSignature` flags.
- **`TELEGRAM_BOT_TOKEN` must be identical for `splitbot-api` and `splitbot-bot`**, and must be the token for the bot that owns the Mini App (`@SplitrrBot`). A mismatched API token also produces `bad_hash`.
- Prefer one shared env file for both units, e.g. `EnvironmentFile=%h/apps/splitbot/.env` on **both** systemd user services. Avoid a divergent `apps/api/.env` vs root `.env`.
- Confirm token: `curl -fsS "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/getMe"` should return `"username":"SplitrrBot"`.
- Reminders: `POST /api/reminders/run` with header `X-Cron-Secret: $REMINDER_CRON_SECRET`.
- Never set `SPLITBOT_DEV_AUTH_BYPASS=true` or `VITE_SPLITBOT_USE_MOCK_DATA=true` for production builds. Mock bill/member fixtures are DEV-only and require the Vite flag.

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

## R2 / receipt upload notes
- API S3 client sets `requestChecksumCalculation` / `responseChecksumValidation` to `WHEN_REQUIRED` (AWS SDK v3.729+ default checksums break R2 `PutObject`).
- Also uses `forcePathStyle: true` for R2-compatible endpoints.
- OCR reads the object from R2 in-process and sends OpenAI a **base64 data URL** (OpenAI often cannot fetch private R2 signed URLs — `Timeout while downloading` / `invalid_image_url`).
- Prefer JPEG/PNG/WebP for scans; HEIC/HEIF is rejected at OCR with a clear error.
- Dig failures: `curl -fsS https://splitrr.ismath.dev/api/pipeline/last-failures`

## R2 Lifecycle Recommendations
- Keep receipt bucket private; serve files with signed URLs only
- Configure lifecycle rules:
  - `receipts/*/original/*` -> delete after 90 days
  - `receipts/*/compressed/*` -> delete after 180 days
- Keep env-separated prefixes via `S3_KEY_PREFIX` (e.g., `receipts/prod`)
