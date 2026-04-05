FROM oven/bun:1.3.11 AS builder

WORKDIR /app/apps/miniapp

COPY tsconfig.base.json /app/
COPY apps/miniapp/ ./

RUN bun install

RUN bun run build

FROM nginx:stable-alpine

COPY --from=builder /app/apps/miniapp/dist /usr/share/nginx/html

