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

RUN npm install -g pnpm@8.15.0

WORKDIR /app

COPY --from=base /app/node_modules ./node_modules
COPY --from=base /app/apps/worker/dist ./apps/worker/dist
COPY --from=base /app/apps/worker/node_modules ./apps/worker/node_modules
COPY --from=base /app/packages ./packages
COPY --from=base /app/apps/worker/package.json ./apps/worker/

CMD ["node", "apps/worker/dist/main.js"]
