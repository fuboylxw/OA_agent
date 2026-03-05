#!/bin/bash
# 全面测试脚本 - 运行所有测试套件

set -e

echo "🚀 Starting Comprehensive Test Suite..."
echo "======================================"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check if API is running
echo -e "\n${YELLOW}Checking if API is running...${NC}"
if curl -f http://localhost:3001/health > /dev/null 2>&1; then
    echo -e "${GREEN}✅ API is running${NC}"
else
    echo -e "${RED}❌ API is not running. Please start the API first:${NC}"
    echo "   docker compose up -d"
    echo "   OR"
    echo "   pnpm dev"
    exit 1
fi

# Install dependencies if needed
if [ ! -d "node_modules" ]; then
    echo -e "\n${YELLOW}Installing dependencies...${NC}"
    pnpm install
fi

# Build if needed
if [ ! -d "apps/api/dist" ]; then
    echo -e "\n${YELLOW}Building project...${NC}"
    pnpm build
fi

# Test results
TOTAL_TESTS=0
PASSED_TESTS=0
FAILED_TESTS=0

# Function to run a test
run_test() {
    local test_name=$1
    local test_script=$2

    echo -e "\n${YELLOW}========================================${NC}"
    echo -e "${YELLOW}Running: $test_name${NC}"
    echo -e "${YELLOW}========================================${NC}"

    TOTAL_TESTS=$((TOTAL_TESTS + 1))

    if ts-node "$test_script"; then
        echo -e "${GREEN}✅ $test_name PASSED${NC}"
        PASSED_TESTS=$((PASSED_TESTS + 1))
        return 0
    else
        echo -e "${RED}❌ $test_name FAILED${NC}"
        FAILED_TESTS=$((FAILED_TESTS + 1))
        return 1
    fi
}

# Run all test suites
echo -e "\n${YELLOW}Starting test execution...${NC}"

# 1. API Tests
run_test "All API Endpoints" "scripts/test-all-apis.ts" || true

# 2. Bootstrap Flow Tests
run_test "Bootstrap Flow" "scripts/test-bootstrap-flow.ts" || true

# 3. Submission Flow Tests
run_test "Submission Flow" "scripts/test-submission-flow.ts" || true

# 4. Unit Tests
echo -e "\n${YELLOW}========================================${NC}"
echo -e "${YELLOW}Running: Unit Tests${NC}"
echo -e "${YELLOW}========================================${NC}"
TOTAL_TESTS=$((TOTAL_TESTS + 1))

cd apps/api
if pnpm test 2>&1 | tee /tmp/unit-test.log; then
    echo -e "${GREEN}✅ Unit Tests PASSED${NC}"
    PASSED_TESTS=$((PASSED_TESTS + 1))
else
    echo -e "${RED}❌ Unit Tests FAILED${NC}"
    FAILED_TESTS=$((FAILED_TESTS + 1))
fi
cd ../..

# 5. Integration Tests
echo -e "\n${YELLOW}========================================${NC}"
echo -e "${YELLOW}Running: Integration Tests${NC}"
echo -e "${YELLOW}========================================${NC}"
TOTAL_TESTS=$((TOTAL_TESTS + 1))

cd apps/api
if pnpm test:integration 2>&1 | tee /tmp/integration-test.log; then
    echo -e "${GREEN}✅ Integration Tests PASSED${NC}"
    PASSED_TESTS=$((PASSED_TESTS + 1))
else
    echo -e "${RED}❌ Integration Tests FAILED${NC}"
    FAILED_TESTS=$((FAILED_TESTS + 1))
fi
cd ../..

# 6. E2E Tests
echo -e "\n${YELLOW}========================================${NC}"
echo -e "${YELLOW}Running: E2E Tests${NC}"
echo -e "${YELLOW}========================================${NC}"
TOTAL_TESTS=$((TOTAL_TESTS + 1))

cd apps/api
if pnpm test:e2e 2>&1 | tee /tmp/e2e-test.log; then
    echo -e "${GREEN}✅ E2E Tests PASSED${NC}"
    PASSED_TESTS=$((PASSED_TESTS + 1))
else
    echo -e "${RED}❌ E2E Tests FAILED${NC}"
    FAILED_TESTS=$((FAILED_TESTS + 1))
fi
cd ../..

# Print summary
echo -e "\n${YELLOW}========================================${NC}"
echo -e "${YELLOW}TEST SUMMARY${NC}"
echo -e "${YELLOW}========================================${NC}"
echo -e "Total Test Suites: $TOTAL_TESTS"
echo -e "${GREEN}Passed: $PASSED_TESTS${NC}"
echo -e "${RED}Failed: $FAILED_TESTS${NC}"

if [ $FAILED_TESTS -eq 0 ]; then
    echo -e "\n${GREEN}🎉 All tests passed!${NC}"
    exit 0
else
    echo -e "\n${RED}❌ Some tests failed. Please check the logs above.${NC}"
    exit 1
fi
