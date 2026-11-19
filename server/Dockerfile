FROM oven/bun:1-alpine

WORKDIR /app
COPY package.json ./
RUN bun install --production

COPY src ./src
COPY public ./public
RUN mkdir -p /app/data && chown -R bun:bun /app
USER bun

ENV PORT=8787
ENV DATABASE_PATH=/app/data/sync.db
EXPOSE 8787

CMD ["bun", "src/index.ts"]
