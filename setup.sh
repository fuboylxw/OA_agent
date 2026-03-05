#!/bin/bash

# UniFlow OA Copilot - Quick Start Script

set -e

echo "🚀 Starting UniFlow OA Copilot..."

# Check if pnpm is installed
if ! command -v pnpm &> /dev/null; then
    echo "❌ pnpm is not installed. Please install it first:"
    echo "   npm install -g pnpm"
    exit 1
fi

# Check if Docker is running
if ! docker info &> /dev/null; then
    echo "❌ Docker is not running. Please start Docker first."
    exit 1
fi

# Step 1: Install dependencies
echo "📦 Installing dependencies..."
pnpm install

# Step 2: Copy environment file if not exists
if [ ! -f .env ]; then
    echo "📝 Creating .env file..."
    cp .env.example .env
fi

# Step 3: Start infrastructure services
echo "🐳 Starting infrastructure services (PostgreSQL, Redis, MinIO)..."
docker compose up -d postgres redis minio

# Wait for services to be ready
echo "⏳ Waiting for services to be ready..."
sleep 10

# Step 4: Run database migrations
echo "🗄️  Running database migrations..."
cd apps/api && pnpm prisma migrate deploy && cd ../..

# Step 5: Generate Prisma client
echo "🔧 Generating Prisma client..."
cd apps/api && pnpm prisma generate && cd ../..

# Step 6: Seed database
echo "🌱 Seeding database..."
cd apps/api && pnpm prisma db seed && cd ../..

# Step 7: Build packages
echo "🔨 Building packages..."
pnpm build

echo ""
echo "✅ Setup complete!"
echo ""
echo "To start the development servers:"
echo "  pnpm dev"
echo ""
echo "Or to start everything with Docker:"
echo "  docker compose up --build"
echo ""
echo "Access points:"
echo "  - Frontend: http://localhost:3000"
echo "  - API: http://localhost:3001"
echo "  - API Docs: http://localhost:3001/api/docs"
echo "  - Health: http://localhost:3001/health"
echo ""
echo "To run the bootstrap smoke test:"
echo "  pnpm bootstrap:smoke"
echo ""
