FROM node:20-alpine AS base

RUN npm install -g pnpm@8.15.0

WORKDIR /app

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* ./
COPY apps/worker/package.json ./apps/worker/
COPY packages/*/package.json ./packages/

RUN pnpm install --frozen-lockfile

COPY . .

RUN pnpm build

FROM node:20-alpine AS production

RUN apk add --no-cache dumb-init

WORKDIR /app

# Create non-root user
RUN addgroup -g 1001 -S appgroup && \
    adduser -S appuser -u 1001 -G appgroup

COPY --from=base --chown=appuser:appgroup /app/node_modules ./node_modules
COPY --from=base --chown=appuser:appgroup /app/apps/worker/dist ./apps/worker/dist
COPY --from=base --chown=appuser:appgroup /app/apps/worker/node_modules ./apps/worker/node_modules
COPY --from=base --chown=appuser:appgroup /app/packages ./packages
COPY --from=base --chown=appuser:appgroup /app/apps/worker/package.json ./apps/worker/

USER appuser

# Use dumb-init for proper signal handling (graceful shutdown)
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "apps/worker/dist/main.js"]
