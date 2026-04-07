FROM node:20-alpine AS base

# Install pnpm
RUN npm install -g pnpm@8.15.0

# Set working directory
WORKDIR /app

# Copy package files
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* ./
COPY apps/api/package.json ./apps/api/
COPY packages/*/package.json ./packages/

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy source code
COPY . .

# Generate Prisma client
RUN cd apps/api && pnpm prisma generate

# Build
RUN pnpm build

# Production stage
FROM node:20-alpine AS production

RUN apk add --no-cache dumb-init

WORKDIR /app

# Create non-root user
RUN addgroup -g 1001 -S appgroup && \
    adduser -S appuser -u 1001 -G appgroup

# Copy built files
COPY --from=base --chown=appuser:appgroup /app/node_modules ./node_modules
COPY --from=base --chown=appuser:appgroup /app/apps/api/dist ./apps/api/dist
COPY --from=base --chown=appuser:appgroup /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=base --chown=appuser:appgroup /app/packages ./packages
COPY --from=base --chown=appuser:appgroup /app/prisma ./prisma
COPY --from=base --chown=appuser:appgroup /app/apps/api/package.json ./apps/api/

USER appuser

EXPOSE 3001

# Use dumb-init for proper signal handling (graceful shutdown)
ENTRYPOINT ["dumb-init", "--"]
CMD ["sh", "-c", "cd apps/api && npx prisma migrate deploy && node dist/main.js"]
