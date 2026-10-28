FROM oven/bun:1.3.11

WORKDIR /app

# Workspace package.json files must all be present for a frozen bun.lock install.
COPY package.json bun.lock tsconfig.base.json tsconfig.json ./
COPY apps/api/package.json ./apps/api/
COPY apps/bot/package.json ./apps/bot/
COPY apps/miniapp/package.json ./apps/miniapp/
COPY packages/db/package.json ./packages/db/
COPY packages/shared/package.json ./packages/shared/

RUN bun install --frozen-lockfile

COPY packages ./packages
COPY apps/api ./apps/api

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

CMD ["bun", "run", "--cwd", "apps/api", "src/index.ts"]
