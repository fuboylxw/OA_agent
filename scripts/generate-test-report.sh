#!/bin/bash

# Generate API test coverage report
# Usage: ./scripts/generate-test-report.sh

API_URL="http://localhost:3001/api/v1"
TENANT_ID="7c46b0e8-3e9c-4d79-8ff1-19481d11c8fe"
USER_ID="e228391e-81b2-401c-8381-995be98b3866"

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo "=========================================="
echo "  API Test Coverage Report Generator"
echo "=========================================="
echo ""

# Check if API is running
echo -n "Checking API server... "
if curl -s "$API_URL/health" > /dev/null 2>&1; then
    echo -e "${GREEN}✓ Running${NC}"
else
    echo -e "${RED}✗ Not running${NC}"
    echo "Please start the API server first: cd apps/api && pnpm dev"
    exit 1
fi
echo ""

# Test each module
declare -A module_results

test_module() {
    local module=$1
    local endpoint=$2

    if curl -s -f "$API_URL$endpoint" > /dev/null 2>&1; then
        module_results[$module]="✓"
        return 0
    else
        module_results[$module]="✗"
        return 1
    fi
}

echo "Testing modules..."
echo ""

# Health
echo -n "  Health Check... "
test_module "health" "/health"
echo -e "${GREEN}${module_results[health]}${NC}"

# Connectors
echo -n "  Connectors... "
test_module "connectors" "/connectors?tenantId=$TENANT_ID"
echo -e "${GREEN}${module_results[connectors]}${NC}"

# Process Library
echo -n "  Process Library... "
test_module "process-library" "/process-library?tenantId=$TENANT_ID"
echo -e "${GREEN}${module_results[process-library]}${NC}"

# Bootstrap
echo -n "  Bootstrap... "
test_module "bootstrap" "/bootstrap/jobs?tenantId=$TENANT_ID"
echo -e "${GREEN}${module_results[bootstrap]}${NC}"

# Assistant
echo -n "  Assistant... "
test_module "assistant" "/assistant/sessions?tenantId=$TENANT_ID&userId=$USER_ID"
echo -e "${GREEN}${module_results[assistant]}${NC}"

# Submissions
echo -n "  Submissions... "
test_module "submissions" "/submissions?tenantId=$TENANT_ID"
echo -e "${GREEN}${module_results[submissions]}${NC}"

# Status
echo -n "  Status... "
test_module "status" "/status/my?tenantId=$TENANT_ID&userId=$USER_ID"
echo -e "${GREEN}${module_results[status]}${NC}"

# Audit
echo -n "  Audit... "
test_module "audit" "/audit/logs?tenantId=$TENANT_ID&limit=1"
echo -e "${GREEN}${module_results[audit]}${NC}"

echo ""
echo "=========================================="
echo "  Coverage Summary"
echo "=========================================="
echo ""

# Count results
total=0
passed=0
for result in "${module_results[@]}"; do
    total=$((total + 1))
    if [ "$result" = "✓" ]; then
        passed=$((passed + 1))
    fi
done

coverage=$((passed * 100 / total))

echo "Modules tested: $total"
echo "Modules passing: $passed"
echo "Coverage: $coverage%"
echo ""

if [ $coverage -eq 100 ]; then
    echo -e "${GREEN}✓ All modules are working!${NC}"
else
    echo -e "${YELLOW}⚠ Some modules need attention${NC}"
fi

echo ""
echo "Detailed report: API_TEST_COMPLETE_REPORT.md"
echo "Testing guide: API_TESTING_GUIDE.md"
echo ""
