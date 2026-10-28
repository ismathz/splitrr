FROM oven/bun:1.3.11 AS builder

WORKDIR /app

COPY package.json bun.lock tsconfig.base.json tsconfig.json ./
COPY packages ./packages
COPY apps/miniapp ./apps/miniapp

ARG VITE_SPLITBOT_API=
ARG VITE_BOT_MINIAPP_API=
ENV VITE_SPLITBOT_API=$VITE_SPLITBOT_API
ENV VITE_BOT_MINIAPP_API=$VITE_BOT_MINIAPP_API

RUN bun install --frozen-lockfile
RUN bun run --cwd apps/miniapp build

FROM nginx:stable-alpine

COPY --from=builder /app/apps/miniapp/dist /usr/share/nginx/html
