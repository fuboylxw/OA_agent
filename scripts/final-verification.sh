#!/bin/bash

# Final verification script - Test all 33 API endpoints
# Usage: ./scripts/final-verification.sh

set -e

API_URL="http://localhost:3001/api/v1"
TENANT_ID="7c46b0e8-3e9c-4d79-8ff1-19481d11c8fe"
USER_ID="e228391e-81b2-401c-8381-995be98b3866"

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

# Counters
TOTAL=0
PASSED=0
FAILED=0

# Test results array
declare -a RESULTS

# Test function
test_api() {
    local name=$1
    local method=$2
    local endpoint=$3
    local data=$4

    TOTAL=$((TOTAL + 1))

    echo -ne "  [$TOTAL] Testing: $name ... "

    if [ -z "$data" ]; then
        response=$(curl -s -w "\n%{http_code}" -X "$method" "$API_URL$endpoint" 2>/dev/null)
    else
        response=$(curl -s -w "\n%{http_code}" -X "$method" "$API_URL$endpoint" \
            -H "Content-Type: application/json" \
            -d "$data" 2>/dev/null)
    fi

    status_code=$(echo "$response" | tail -n 1)

    if [ "$status_code" -ge 200 ] && [ "$status_code" -lt 300 ]; then
        echo -e "${GREEN}✓ PASS${NC} (HTTP $status_code)"
        PASSED=$((PASSED + 1))
        RESULTS+=("✓ $name")
        return 0
    else
        echo -e "${RED}✗ FAIL${NC} (HTTP $status_code)"
        FAILED=$((FAILED + 1))
        RESULTS+=("✗ $name")
        return 1
    fi
}

echo ""
echo -e "${CYAN}=========================================="
echo "  UniFlow OA API - Final Verification"
echo "==========================================${NC}"
echo ""

# Check if API is running
echo -n "Checking API server... "
if curl -s "$API_URL/health" > /dev/null 2>&1; then
    echo -e "${GREEN}✓ Running${NC}"
else
    echo -e "${RED}✗ Not running${NC}"
    echo ""
    echo "Please start the API server first:"
    echo "  cd apps/api && pnpm dev"
    exit 1
fi
echo ""

# 1. Health Check (1 endpoint)
echo -e "${BLUE}=== 1. Health Check (1 endpoint) ===${NC}"
test_api "Health check" "GET" "/health"
echo ""

# 2. Connectors (6 endpoints)
echo -e "${BLUE}=== 2. Connectors (6 endpoints) ===${NC}"
test_api "List connectors" "GET" "/connectors?tenantId=$TENANT_ID"
test_api "Get connector by ID" "GET" "/connectors/414c145b-bd5e-439f-8dff-36c3584b84ae"
test_api "Health check connector" "POST" "/connectors/414c145b-bd5e-439f-8dff-36c3584b84ae/health-check"
test_api "Create connector" "POST" "/connectors" \
    '{"name":"Verification Test","oaType":"openapi","baseUrl":"http://example.com","authType":"apikey","authConfig":{"key":"test"},"oclLevel":"OCL2"}'
test_api "Update connector" "PUT" "/connectors/414c145b-bd5e-439f-8dff-36c3584b84ae" \
    '{"name":"Updated Name"}'

# Get a connector ID for deletion test
CONNECTOR_ID=$(curl -s -X POST "$API_URL/connectors" \
    -H "Content-Type: application/json" \
    -d '{"name":"To Delete","oaType":"openapi","baseUrl":"http://example.com","authType":"apikey","authConfig":{"key":"test"},"oclLevel":"OCL1"}' \
    | python3 -c "import sys, json; data=json.load(sys.stdin); print(data.get('id', ''))" 2>/dev/null)

if [ -n "$CONNECTOR_ID" ]; then
    test_api "Delete connector" "DELETE" "/connectors/$CONNECTOR_ID"
else
    echo -e "  [6] Testing: Delete connector ... ${YELLOW}⚠ SKIP${NC} (No ID)"
fi
echo ""

# 3. Process Library (4 endpoints)
echo -e "${BLUE}=== 3. Process Library (4 endpoints) ===${NC}"
test_api "List process templates" "GET" "/process-library?tenantId=$TENANT_ID"
test_api "Get process by code" "GET" "/process-library/travel_expense?tenantId=$TENANT_ID"
test_api "Get process by ID" "GET" "/process-library/id/test-template-001"
test_api "List process versions" "GET" "/process-library/travel_expense/versions?tenantId=$TENANT_ID"
echo ""

# 4. Bootstrap (5 endpoints)
echo -e "${BLUE}=== 4. Bootstrap (5 endpoints) ===${NC}"
test_api "List bootstrap jobs" "GET" "/bootstrap/jobs?tenantId=$TENANT_ID"
test_api "Create bootstrap job" "POST" "/bootstrap/jobs" \
    '{"oaUrl":"http://verify.example.com","openApiUrl":"http://verify.example.com/openapi.json"}'

# Get a job ID for testing
JOB_ID=$(curl -s "$API_URL/bootstrap/jobs?tenantId=$TENANT_ID" \
    | python3 -c "import sys, json; data=json.load(sys.stdin); print(data[0]['id'] if data else '')" 2>/dev/null)

if [ -n "$JOB_ID" ]; then
    test_api "Get bootstrap job" "GET" "/bootstrap/jobs/$JOB_ID"
    test_api "Get bootstrap report" "GET" "/bootstrap/jobs/$JOB_ID/report"
else
    echo -e "  Testing: Get bootstrap job ... ${YELLOW}⚠ SKIP${NC} (No job)"
    echo -e "  Testing: Get bootstrap report ... ${YELLOW}⚠ SKIP${NC} (No job)"
fi

# Note: Publish endpoint requires job to be in REVIEW status, skip for now
echo -e "  Testing: Publish bootstrap job ... ${YELLOW}⚠ SKIP${NC} (Requires REVIEW status)"
echo ""

# 5. Assistant (3 endpoints)
echo -e "${BLUE}=== 5. Assistant (3 endpoints) ===${NC}"
test_api "Chat with assistant" "POST" "/assistant/chat" \
    '{"message":"我要报销差旅费","userId":"'$USER_ID'"}'
test_api "List chat sessions" "GET" "/assistant/sessions?tenantId=$TENANT_ID&userId=$USER_ID"

# Get a session ID
SESSION_ID=$(curl -s "$API_URL/assistant/sessions?tenantId=$TENANT_ID&userId=$USER_ID" \
    | python3 -c "import sys, json; data=json.load(sys.stdin); print(data[0]['id'] if data else '')" 2>/dev/null)

if [ -n "$SESSION_ID" ]; then
    test_api "Get session messages" "GET" "/assistant/sessions/$SESSION_ID/messages"
else
    echo -e "  Testing: Get session messages ... ${YELLOW}⚠ SKIP${NC} (No session)"
fi
echo ""

# 6. Submissions (7 endpoints)
echo -e "${BLUE}=== 6. Submissions (7 endpoints) ===${NC}"
test_api "List submissions" "GET" "/submissions?tenantId=$TENANT_ID"

# Get a submission ID for testing actions
SUBMISSION_ID=$(curl -s "$API_URL/submissions?tenantId=$TENANT_ID" \
    | python3 -c "import sys, json; data=json.load(sys.stdin); print(data[0]['id'] if len(data) > 0 else '')" 2>/dev/null)

if [ -n "$SUBMISSION_ID" ]; then
    test_api "Get submission by ID" "GET" "/submissions/$SUBMISSION_ID"
    test_api "Urge submission" "POST" "/submissions/$SUBMISSION_ID/urge?userId=$USER_ID"
    test_api "Supplement submission" "POST" "/submissions/$SUBMISSION_ID/supplement?userId=$USER_ID" \
        '{"supplementData":{"note":"test"}}'
    test_api "Delegate submission" "POST" "/submissions/$SUBMISSION_ID/delegate?userId=$USER_ID" \
        '{"targetUserId":"3e5c8252-04f5-40e1-89df-99e62f766ae1","reason":"test"}'
    test_api "Cancel submission" "POST" "/submissions/$SUBMISSION_ID/cancel?userId=$USER_ID"
else
    echo -e "  Testing: Get submission by ID ... ${YELLOW}⚠ SKIP${NC} (No submission)"
    echo -e "  Testing: Urge submission ... ${YELLOW}⚠ SKIP${NC} (No submission)"
    echo -e "  Testing: Supplement submission ... ${YELLOW}⚠ SKIP${NC} (No submission)"
    echo -e "  Testing: Delegate submission ... ${YELLOW}⚠ SKIP${NC} (No submission)"
    echo -e "  Testing: Cancel submission ... ${YELLOW}⚠ SKIP${NC} (No submission)"
fi

# Create a new submission for testing
echo -e "  Testing: Create submission ... ${YELLOW}⚠ SKIP${NC} (Requires draft)"
echo ""

# 7. Status (3 endpoints)
echo -e "${BLUE}=== 7. Status (3 endpoints) ===${NC}"
test_api "List my submissions" "GET" "/status/my?tenantId=$TENANT_ID&userId=$USER_ID"

if [ -n "$SUBMISSION_ID" ]; then
    test_api "Query submission status" "GET" "/status/submissions/$SUBMISSION_ID"
    test_api "Get submission timeline" "GET" "/status/submissions/$SUBMISSION_ID/timeline"
else
    echo -e "  Testing: Query submission status ... ${YELLOW}⚠ SKIP${NC} (No submission)"
    echo -e "  Testing: Get submission timeline ... ${YELLOW}⚠ SKIP${NC} (No submission)"
fi
echo ""

# 8. Permission (1 endpoint)
echo -e "${BLUE}=== 8. Permission (1 endpoint) ===${NC}"
test_api "Check permission" "POST" "/permission/check" \
    '{"userId":"'$USER_ID'","processCode":"travel_expense","action":"submit"}'
echo ""

# 9. Audit (3 endpoints)
echo -e "${BLUE}=== 9. Audit (3 endpoints) ===${NC}"
test_api "Query audit logs" "GET" "/audit/logs?tenantId=$TENANT_ID&limit=10"
test_api "Get audit stats" "GET" "/audit/stats?tenantId=$TENANT_ID"

# Get a trace ID
TRACE_ID=$(curl -s "$API_URL/audit/logs?tenantId=$TENANT_ID&limit=1" \
    | python3 -c "import sys, json; data=json.load(sys.stdin); print(data['logs'][0]['traceId'] if data.get('logs') else '')" 2>/dev/null)

if [ -n "$TRACE_ID" ]; then
    test_api "Get audit trace" "GET" "/audit/trace/$TRACE_ID?tenantId=$TENANT_ID"
else
    echo -e "  Testing: Get audit trace ... ${YELLOW}⚠ SKIP${NC} (No trace)"
fi
echo ""

# Summary
echo -e "${CYAN}=========================================="
echo "  Verification Summary"
echo "==========================================${NC}"
echo ""
echo "Total endpoints tested: $TOTAL"
echo -e "${GREEN}Passed: $PASSED${NC}"
echo -e "${RED}Failed: $FAILED${NC}"

if [ $FAILED -eq 0 ]; then
    COVERAGE=$((PASSED * 100 / TOTAL))
    echo ""
    echo -e "${GREEN}✓ All tested endpoints are working!${NC}"
    echo "Coverage: $COVERAGE%"
    echo ""
    echo "Note: Some endpoints were skipped due to missing test data."
    echo "Run './scripts/test-complete-workflow.sh' for full workflow testing."
else
    echo ""
    echo -e "${RED}✗ Some endpoints failed!${NC}"
    echo ""
    echo "Failed endpoints:"
    for result in "${RESULTS[@]}"; do
        if [[ $result == ✗* ]]; then
            echo "  $result"
        fi
    done
fi

echo ""
echo "Detailed reports:"
echo "  - API_TEST_COMPLETE_REPORT.md"
echo "  - API_TESTING_GUIDE.md"
echo "  - API_TESTING_SUMMARY.md"
echo ""

exit $FAILED
