FROM oven/bun:1.3.11 AS builder

WORKDIR /app

COPY apps/miniapp/ ./

RUN bun install

COPY apps/miniapp/ ./

RUN bun run build

FROM nginx:stable-alpine

COPY --from=builder /app/dist /usr/share/nginx/html

