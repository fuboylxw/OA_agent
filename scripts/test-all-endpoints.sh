#!/bin/bash

# Test all API endpoints
# Usage: ./scripts/test-all-endpoints.sh

set -e

API_URL="http://localhost:3001/api/v1"
TENANT_ID="7c46b0e8-3e9c-4d79-8ff1-19481d11c8fe"
USER_ID="e228391e-81b2-401c-8381-995be98b3866"

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Counters
TOTAL=0
PASSED=0
FAILED=0

# Test function
test_endpoint() {
    local name=$1
    local method=$2
    local endpoint=$3
    local data=$4
    local expected_status=${5:-200}

    TOTAL=$((TOTAL + 1))

    echo -n "Testing: $name ... "

    if [ -z "$data" ]; then
        response=$(curl -s -w "\n%{http_code}" -X "$method" "$API_URL$endpoint")
    else
        response=$(curl -s -w "\n%{http_code}" -X "$method" "$API_URL$endpoint" \
            -H "Content-Type: application/json" \
            -d "$data")
    fi

    status_code=$(echo "$response" | tail -n 1)
    body=$(echo "$response" | sed '$d')

    if [ "$status_code" -eq "$expected_status" ] || [ "$status_code" -eq 200 ] || [ "$status_code" -eq 201 ]; then
        echo -e "${GREEN}✓ PASS${NC} (HTTP $status_code)"
        PASSED=$((PASSED + 1))
        return 0
    else
        echo -e "${RED}✗ FAIL${NC} (HTTP $status_code)"
        echo "  Response: $body"
        FAILED=$((FAILED + 1))
        return 1
    fi
}

echo "=========================================="
echo "  UniFlow OA API Endpoint Tests"
echo "=========================================="
echo ""

# Health Check
echo "=== Health Check ==="
test_endpoint "Health check" "GET" "/health"
echo ""

# Connectors
echo "=== Connectors ==="
test_endpoint "List connectors" "GET" "/connectors?tenantId=$TENANT_ID"
test_endpoint "Get connector by ID" "GET" "/connectors/414c145b-bd5e-439f-8dff-36c3584b84ae"
test_endpoint "Health check connector" "POST" "/connectors/414c145b-bd5e-439f-8dff-36c3584b84ae/health-check"
test_endpoint "Create connector" "POST" "/connectors" \
    '{"name":"Test Connector","oaType":"openapi","baseUrl":"http://example.com","authType":"apikey","authConfig":{"key":"test"},"oclLevel":"OCL2"}'
test_endpoint "Update connector" "PUT" "/connectors/414c145b-bd5e-439f-8dff-36c3584b84ae" \
    '{"name":"Updated Connector"}'
echo ""

# Process Library
echo "=== Process Library ==="
test_endpoint "List process templates" "GET" "/process-library?tenantId=$TENANT_ID"
test_endpoint "Get process by code" "GET" "/process-library/travel_expense?tenantId=$TENANT_ID"
test_endpoint "Get process by ID" "GET" "/process-library/id/test-template-001"
test_endpoint "List process versions" "GET" "/process-library/travel_expense/versions?tenantId=$TENANT_ID"
echo ""

# Bootstrap
echo "=== Bootstrap ==="
test_endpoint "List bootstrap jobs" "GET" "/bootstrap/jobs?tenantId=$TENANT_ID"
test_endpoint "Create bootstrap job" "POST" "/bootstrap/jobs" \
    '{"oaUrl":"http://test.example.com","openApiUrl":"http://test.example.com/openapi.json"}'
test_endpoint "Get bootstrap job" "GET" "/bootstrap/jobs/538825a2-9c0e-4496-b670-d3ae80c0a107"
test_endpoint "Get bootstrap report" "GET" "/bootstrap/jobs/538825a2-9c0e-4496-b670-d3ae80c0a107/report"
echo ""

# Assistant
echo "=== Assistant ==="
test_endpoint "Chat with assistant" "POST" "/assistant/chat" \
    '{"message":"我要报销差旅费","userId":"'$USER_ID'"}'
test_endpoint "List chat sessions" "GET" "/assistant/sessions?tenantId=$TENANT_ID&userId=$USER_ID"
echo ""

# Submissions
echo "=== Submissions ==="
test_endpoint "List submissions" "GET" "/submissions?tenantId=$TENANT_ID"
echo ""

# Status
echo "=== Status ==="
test_endpoint "List my submissions" "GET" "/status/my?tenantId=$TENANT_ID&userId=$USER_ID"
echo ""

# Permission
echo "=== Permission ==="
test_endpoint "Check permission" "POST" "/permission/check" \
    '{"userId":"'$USER_ID'","processCode":"travel_expense","action":"submit"}'
echo ""

# Audit
echo "=== Audit ==="
test_endpoint "Query audit logs" "GET" "/audit/logs?tenantId=$TENANT_ID&limit=10"
test_endpoint "Get audit stats" "GET" "/audit/stats?tenantId=$TENANT_ID"
echo ""

# Summary
echo "=========================================="
echo "  Test Summary"
echo "=========================================="
echo -e "Total:  $TOTAL"
echo -e "${GREEN}Passed: $PASSED${NC}"
echo -e "${RED}Failed: $FAILED${NC}"
echo ""

if [ $FAILED -eq 0 ]; then
    echo -e "${GREEN}All tests passed!${NC}"
    exit 0
else
    echo -e "${RED}Some tests failed!${NC}"
    exit 1
fi