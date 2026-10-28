FROM oven/bun:1.3.11

WORKDIR /app

COPY package.json bun.lock tsconfig.base.json tsconfig.json ./
COPY packages ./packages
COPY apps/api ./apps/api

RUN bun install --frozen-lockfile

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

CMD ["bun", "run", "--cwd", "apps/api", "src/index.ts"]
