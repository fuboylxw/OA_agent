#!/bin/bash

echo "🚀 开始后端API完整测试"
echo "======================================"

# 颜色定义
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# 检查服务是否运行
check_service() {
    local url=$1
    local name=$2

    echo -n "检查 $name... "
    if curl -s -f -o /dev/null "$url"; then
        echo -e "${GREEN}✓ 运行中${NC}"
        return 0
    else
        echo -e "${RED}✗ 未运行${NC}"
        return 1
    fi
}

# 1. 检查必要服务
echo ""
echo "📋 步骤 1: 检查服务状态"
echo "--------------------------------------"

check_service "http://localhost:3001/health" "API服务" || {
    echo -e "${RED}错误: API服务未运行${NC}"
    echo "请先启动API服务: cd apps/api && pnpm dev"
    exit 1
}

check_service "http://localhost:5432" "PostgreSQL" || {
    echo -e "${YELLOW}警告: PostgreSQL可能未运行${NC}"
}

check_service "http://localhost:6379" "Redis" || {
    echo -e "${YELLOW}警告: Redis可能未运行${NC}"
}

# 2. 准备测试数据
echo ""
echo "📋 步骤 2: 准备测试数据"
echo "--------------------------------------"

echo "运行数据库迁移..."
pnpm prisma migrate deploy

echo "创建测试数据..."
pnpm tsx prisma/seed-test.ts

# 3. 运行测试
echo ""
echo "📋 步骤 3: 运行API测试"
echo "--------------------------------------"

pnpm tsx scripts/test-backend-apis.ts

# 4. 显示结果
TEST_EXIT_CODE=$?

echo ""
echo "======================================"
if [ $TEST_EXIT_CODE -eq 0 ]; then
    echo -e "${GREEN}✅ 所有测试通过！${NC}"
else
    echo -e "${RED}❌ 部分测试失败${NC}"
    echo "请查看测试报告: test-reports/backend-api-test-report.json"
fi
echo "======================================"

exit $TEST_EXIT_CODE