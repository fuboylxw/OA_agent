#!/bin/bash

# UniFlow OA Copilot - Verification Script
# This script verifies that all components are properly set up

set -e

echo "🔍 UniFlow OA Copilot - System Verification"
echo "==========================================="
echo ""

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check functions
check_command() {
    if command -v $1 &> /dev/null; then
        echo -e "${GREEN}✓${NC} $1 is installed"
        return 0
    else
        echo -e "${RED}✗${NC} $1 is not installed"
        return 1
    fi
}

check_file() {
    if [ -f "$1" ]; then
        echo -e "${GREEN}✓${NC} $1 exists"
        return 0
    else
        echo -e "${RED}✗${NC} $1 not found"
        return 1
    fi
}

check_directory() {
    if [ -d "$1" ]; then
        echo -e "${GREEN}✓${NC} $1 exists"
        return 0
    else
        echo -e "${RED}✗${NC} $1 not found"
        return 1
    fi
}

# Check prerequisites
echo "📋 Checking Prerequisites..."
check_command node
check_command pnpm
check_command docker
check_command docker-compose || check_command "docker compose"
echo ""

# Check project structure
echo "📁 Checking Project Structure..."
check_directory "apps/api"
check_directory "apps/worker"
check_directory "apps/web"
check_directory "packages/shared-types"
check_directory "packages/shared-schema"
check_directory "packages/agent-kernel"
check_directory "packages/oa-adapters"
check_directory "packages/compat-engine"
check_directory "fixtures/oa_samples"
check_directory "prisma"
check_directory "scripts"
check_directory "docs"
echo ""

# Check key files
echo "📄 Checking Key Files..."
check_file "package.json"
check_file "pnpm-workspace.yaml"
check_file "turbo.json"
check_file "docker-compose.yml"
check_file ".env.example"
check_file "prisma/schema.prisma"
check_file "apps/api/src/main.ts"
check_file "apps/worker/src/main.ts"
check_file "apps/web/src/app/page.tsx"
check_file "README.md"
check_file "FINAL_SUMMARY.md"
echo ""

# Check documentation
echo "📚 Checking Documentation..."
check_file "docs/API.md"
check_file "docs/ARCHITECTURE.md"
check_file "docs/DEVELOPMENT.md"
check_file "docs/TROUBLESHOOTING.md"
check_file "DEPLOYMENT.md"
check_file "CONTRIBUTING.md"
check_file "SECURITY.md"
check_file "CHANGELOG.md"
echo ""

# Check modules
echo "🔧 Checking Backend Modules..."
check_directory "apps/api/src/modules/bootstrap"
check_directory "apps/api/src/modules/discovery"
check_directory "apps/api/src/modules/ir-normalizer"
check_directory "apps/api/src/modules/adapter-compiler"
check_directory "apps/api/src/modules/replay-validator"
check_directory "apps/api/src/modules/connector"
check_directory "apps/api/src/modules/process-library"
check_directory "apps/api/src/modules/audit"
check_directory "apps/api/src/modules/permission"
check_directory "apps/api/src/modules/assistant"
check_directory "apps/api/src/modules/rule"
check_directory "apps/api/src/modules/submission"
check_directory "apps/api/src/modules/status"
check_directory "apps/api/src/modules/common"
echo ""

# Check agents
echo "🤖 Checking AI Agents..."
check_file "apps/api/src/modules/discovery/oa-discovery.agent.ts"
check_file "apps/api/src/modules/assistant/agents/intent.agent.ts"
check_file "apps/api/src/modules/assistant/agents/flow.agent.ts"
check_file "apps/api/src/modules/assistant/agents/form.agent.ts"
echo ""

# Check frontend pages
echo "🎨 Checking Frontend Pages..."
check_file "apps/web/src/app/page.tsx"
check_file "apps/web/src/app/login/page.tsx"
check_file "apps/web/src/app/chat/page.tsx"
check_file "apps/web/src/app/submissions/page.tsx"
check_file "apps/web/src/app/processes/page.tsx"
check_file "apps/web/src/app/bootstrap/page.tsx"
check_file "apps/web/src/app/connectors/page.tsx"
echo ""

# Check fixtures
echo "🧪 Checking OA Fixtures..."
check_directory "fixtures/oa_samples/openapi-type"
check_directory "fixtures/oa_samples/form-page-type"
check_directory "fixtures/oa_samples/hybrid-type"
check_file "fixtures/oa_samples/openapi-type/openapi.json"
check_file "fixtures/oa_samples/form-page-type/purchase_form.html"
echo ""

# Check tests
echo "🧪 Checking Tests..."
check_file "apps/api/test/e2e.spec.ts"
check_file "apps/api/src/modules/bootstrap/bootstrap.service.spec.ts"
check_file "packages/compat-engine/src/ocl-calculator.spec.ts"
check_file "packages/compat-engine/src/fal-calculator.spec.ts"
check_file "packages/compat-engine/src/capability-detector.spec.ts"
check_file "packages/oa-adapters/src/index.spec.ts"
echo ""

# Check configuration
echo "⚙️  Checking Configuration Files..."
check_file ".eslintrc.json"
check_file ".prettierrc"
check_file "tsconfig.json"
check_file ".github/workflows/ci.yml"
check_file "apps/api/nest-cli.json"
check_file "apps/api/jest.config.js"
check_file "apps/web/next.config.js"
check_file "apps/web/tailwind.config.js"
echo ""

# Count files
echo "📊 Project Statistics..."
TOTAL_FILES=$(find . -type f \( -name "*.ts" -o -name "*.tsx" -o -name "*.json" -o -name "*.md" \) ! -path "*/node_modules/*" ! -path "*/.next/*" ! -path "*/dist/*" | wc -l)
echo "Total project files: $TOTAL_FILES"

TS_FILES=$(find . -type f \( -name "*.ts" -o -name "*.tsx" \) ! -path "*/node_modules/*" ! -path "*/.next/*" ! -path "*/dist/*" | wc -l)
echo "TypeScript files: $TS_FILES"

MD_FILES=$(find . -type f -name "*.md" ! -path "*/node_modules/*" | wc -l)
echo "Documentation files: $MD_FILES"
echo ""

# Check if dependencies are installed
echo "📦 Checking Dependencies..."
if [ -d "node_modules" ]; then
    echo -e "${GREEN}✓${NC} Dependencies are installed"
else
    echo -e "${YELLOW}⚠${NC} Dependencies not installed. Run: pnpm install"
fi
echo ""

# Check if .env exists
echo "🔐 Checking Environment..."
if [ -f ".env" ]; then
    echo -e "${GREEN}✓${NC} .env file exists"
else
    echo -e "${YELLOW}⚠${NC} .env file not found. Run: cp .env.example .env"
fi
echo ""

# Check Docker services
echo "🐳 Checking Docker Services..."
if docker compose ps postgres &> /dev/null; then
    echo -e "${GREEN}✓${NC} PostgreSQL is running"
else
    echo -e "${YELLOW}⚠${NC} PostgreSQL is not running"
fi

if docker compose ps redis &> /dev/null; then
    echo -e "${GREEN}✓${NC} Redis is running"
else
    echo -e "${YELLOW}⚠${NC} Redis is not running"
fi

if docker compose ps minio &> /dev/null; then
    echo -e "${GREEN}✓${NC} MinIO is running"
else
    echo -e "${YELLOW}⚠${NC} MinIO is not running"
fi
echo ""

# Summary
echo "==========================================="
echo "✅ Verification Complete!"
echo ""
echo "Next steps:"
echo "1. If dependencies not installed: pnpm install"
echo "2. If .env not found: cp .env.example .env"
echo "3. If services not running: docker compose up -d postgres redis minio"
echo "4. Run migrations: pnpm db:migrate"
echo "5. Seed database: pnpm db:seed"
echo "6. Build packages: pnpm build"
echo "7. Start development: pnpm dev"
echo ""
echo "Or use the quick start script: ./setup.sh"
echo ""
