FROM node:20-alpine AS base

RUN npm install -g pnpm@8.15.0

WORKDIR /app

ARG NEXT_OUTPUT_MODE=standalone
ENV NEXT_OUTPUT_MODE=$NEXT_OUTPUT_MODE

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* ./
COPY apps/web/package.json ./apps/web/
COPY packages/*/package.json ./packages/

RUN pnpm install --frozen-lockfile

COPY . .

RUN cd apps/web && pnpm build

FROM node:20-alpine AS production

RUN apk add --no-cache dumb-init

WORKDIR /app

# Create non-root user
RUN addgroup -g 1001 -S appgroup && \
    adduser -S appuser -u 1001 -G appgroup

COPY --from=base --chown=appuser:appgroup /app/apps/web/.next/standalone ./
COPY --from=base --chown=appuser:appgroup /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=base --chown=appuser:appgroup /app/apps/web/public ./apps/web/public

USER appuser

EXPOSE 3000

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "apps/web/server.js"]
