FROM oven/bun:1.3.11

WORKDIR /app

COPY package.json bun.lock tsconfig.base.json tsconfig.json ./
COPY packages ./packages
COPY apps/bot ./apps/bot

RUN bun install --frozen-lockfile

ENV NODE_ENV=production
ENV BOT_PORT=3001

EXPOSE 3001

CMD ["bun", "run", "--cwd", "apps/bot", "src/index.ts"]
