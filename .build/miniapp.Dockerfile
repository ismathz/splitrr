FROM oven/bun:1.3.11 AS builder

WORKDIR /app

COPY apps/miniapp/package.json apps/miniapp/bun.lockb ./

RUN bun install

COPY apps/miniapp/ ./

RUN bun build

FROM nginx:stable-alpine

COPY --from=builder /app/dist /usr/share/nginx/html

