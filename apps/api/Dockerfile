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

RUN npm install -g pnpm@8.15.0

WORKDIR /app

# Copy built files
COPY --from=base /app/node_modules ./node_modules
COPY --from=base /app/apps/api/dist ./apps/api/dist
COPY --from=base /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=base /app/packages ./packages
COPY --from=base /app/prisma ./prisma
COPY --from=base /app/apps/api/package.json ./apps/api/

# Run migrations on startup
CMD cd apps/api && pnpm prisma migrate deploy && node dist/main.js
