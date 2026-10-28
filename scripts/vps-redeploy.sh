#!/usr/bin/env bash
# Manual / on-box mirror of the verified VPS Admin redeploy recipe.
# GitHub Actions inlines the same steps via appleboy/ssh-action (see deploy-vps.yml).
# reset --hard discards local mods to tracked files on purpose.
# Untracked data/ (sqlite) and .env survive (gitignored; this script never runs git clean).
# Does not overwrite .env. Does not restart cloudflared-splitbot. Not Docker.
set -euo pipefail

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
