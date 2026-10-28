FROM oven/bun:1.3.11 AS builder

WORKDIR /app

# Workspace package.json files must all be present for a frozen bun.lock install.
COPY package.json bun.lock tsconfig.base.json tsconfig.json ./
COPY apps/api/package.json ./apps/api/
COPY apps/bot/package.json ./apps/bot/
COPY apps/miniapp/package.json ./apps/miniapp/
COPY packages/db/package.json ./packages/db/
COPY packages/shared/package.json ./packages/shared/

ARG VITE_SPLITBOT_API=
ARG VITE_BOT_MINIAPP_API=
ENV VITE_SPLITBOT_API=$VITE_SPLITBOT_API
ENV VITE_BOT_MINIAPP_API=$VITE_BOT_MINIAPP_API

RUN bun install --frozen-lockfile

COPY packages ./packages
COPY apps/miniapp ./apps/miniapp

RUN bun run --cwd apps/miniapp build

FROM nginx:stable-alpine

COPY --from=builder /app/apps/miniapp/dist /usr/share/nginx/html
