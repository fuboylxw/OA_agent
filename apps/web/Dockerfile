FROM node:20-alpine AS base

RUN npm install -g pnpm@8.15.0

WORKDIR /app

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* ./
COPY apps/web/package.json ./apps/web/
COPY packages/*/package.json ./packages/

RUN pnpm install --frozen-lockfile

COPY . .

RUN cd apps/web && pnpm build

FROM node:20-alpine AS production

RUN npm install -g pnpm@8.15.0

WORKDIR /app

COPY --from=base /app/apps/web/.next/standalone ./
COPY --from=base /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=base /app/apps/web/public ./apps/web/public

EXPOSE 3000

CMD ["node", "apps/web/server.js"]
