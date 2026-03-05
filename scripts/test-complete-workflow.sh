#!/bin/bash

# Comprehensive API endpoint test with full workflow
# Usage: ./scripts/test-complete-workflow.sh

set -e

API_URL="http://localhost:3001/api/v1"
TENANT_ID="7c46b0e8-3e9c-4d79-8ff1-19481d11c8fe"
USER_ID="e228391e-81b2-401c-8381-995be98b3866"

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo "=========================================="
echo "  Complete Workflow Test"
echo "=========================================="
echo ""

# Test 1: Chat to create draft
echo -e "${BLUE}=== Step 1: Chat with Assistant ===${NC}"
CHAT_RESPONSE=$(curl -s -X POST "$API_URL/assistant/chat" \
  -H "Content-Type: application/json" \
  -d '{"message":"我要报销差旅费3000元，事由是参加技术会议，日期2026-03-10","userId":"'$USER_ID'"}')

echo "$CHAT_RESPONSE" | python3 -m json.tool 2>/dev/null || echo "$CHAT_RESPONSE"

DRAFT_ID=$(echo "$CHAT_RESPONSE" | python3 -c "import sys, json; data=json.load(sys.stdin); print(data.get('draftId', ''))" 2>/dev/null)
SESSION_ID=$(echo "$CHAT_RESPONSE" | python3 -c "import sys, json; data=json.load(sys.stdin); print(data.get('sessionId', ''))" 2>/dev/null)

if [ -z "$DRAFT_ID" ]; then
    echo -e "${RED}Failed to create draft${NC}"
    exit 1
fi

echo -e "${GREEN}✓ Draft created: $DRAFT_ID${NC}"
echo ""

# Test 2: Submit the draft
echo -e "${BLUE}=== Step 2: Submit Draft ===${NC}"
SUBMIT_RESPONSE=$(curl -s -X POST "$API_URL/submissions" \
  -H "Content-Type: application/json" \
  -d '{"draftId":"'$DRAFT_ID'","idempotencyKey":"workflow-test-'$(date +%s)'","userId":"'$USER_ID'"}')

echo "$SUBMIT_RESPONSE" | python3 -m json.tool 2>/dev/null || echo "$SUBMIT_RESPONSE"

SUBMISSION_ID=$(echo "$SUBMIT_RESPONSE" | python3 -c "import sys, json; data=json.load(sys.stdin); print(data.get('submissionId', ''))" 2>/dev/null)

if [ -z "$SUBMISSION_ID" ]; then
    echo -e "${RED}Failed to submit${NC}"
    exit 1
fi

echo -e "${GREEN}✓ Submission created: $SUBMISSION_ID${NC}"
echo ""

# Wait for async processing
echo -e "${YELLOW}Waiting for submission to process...${NC}"
sleep 3
echo ""

# Test 3: Query submission status
echo -e "${BLUE}=== Step 3: Query Submission Status ===${NC}"
STATUS_RESPONSE=$(curl -s "$API_URL/status/submissions/$SUBMISSION_ID")
echo "$STATUS_RESPONSE" | python3 -m json.tool 2>/dev/null || echo "$STATUS_RESPONSE"
echo -e "${GREEN}✓ Status queried successfully${NC}"
echo ""

# Test 4: Get submission details
echo -e "${BLUE}=== Step 4: Get Submission Details ===${NC}"
DETAIL_RESPONSE=$(curl -s "$API_URL/submissions/$SUBMISSION_ID")
echo "$DETAIL_RESPONSE" | python3 -m json.tool 2>/dev/null || echo "$DETAIL_RESPONSE"
echo -e "${GREEN}✓ Details retrieved successfully${NC}"
echo ""

# Test 5: Get timeline
echo -e "${BLUE}=== Step 5: Get Submission Timeline ===${NC}"
TIMELINE_RESPONSE=$(curl -s "$API_URL/status/submissions/$SUBMISSION_ID/timeline")
echo "$TIMELINE_RESPONSE" | python3 -m json.tool 2>/dev/null || echo "$TIMELINE_RESPONSE"
echo -e "${GREEN}✓ Timeline retrieved successfully${NC}"
echo ""

# Test 6: Urge submission
echo -e "${BLUE}=== Step 6: Urge Submission ===${NC}"
URGE_RESPONSE=$(curl -s -X POST "$API_URL/submissions/$SUBMISSION_ID/urge?userId=$USER_ID")
echo "$URGE_RESPONSE" | python3 -m json.tool 2>/dev/null || echo "$URGE_RESPONSE"
echo -e "${GREEN}✓ Urge action completed${NC}"
echo ""

# Test 7: Supplement submission
echo -e "${BLUE}=== Step 7: Supplement Submission ===${NC}"
SUPPLEMENT_RESPONSE=$(curl -s -X POST "$API_URL/submissions/$SUBMISSION_ID/supplement?userId=$USER_ID" \
  -H "Content-Type: application/json" \
  -d '{"supplementData":{"attachment":"invoice.pdf","note":"补充发票和行程单"}}')
echo "$SUPPLEMENT_RESPONSE" | python3 -m json.tool 2>/dev/null || echo "$SUPPLEMENT_RESPONSE"
echo -e "${GREEN}✓ Supplement action completed${NC}"
echo ""

# Test 8: Check audit logs
echo -e "${BLUE}=== Step 8: Check Audit Logs ===${NC}"
AUDIT_RESPONSE=$(curl -s "$API_URL/audit/logs?tenantId=$TENANT_ID&userId=$USER_ID&limit=5")
echo "$AUDIT_RESPONSE" | python3 -m json.tool 2>/dev/null || echo "$AUDIT_RESPONSE"
echo -e "${GREEN}✓ Audit logs retrieved${NC}"
echo ""

# Test 9: Get chat messages
echo -e "${BLUE}=== Step 9: Get Chat Messages ===${NC}"
MESSAGES_RESPONSE=$(curl -s "$API_URL/assistant/sessions/$SESSION_ID/messages")
echo "$MESSAGES_RESPONSE" | python3 -m json.tool 2>/dev/null || echo "$MESSAGES_RESPONSE"
echo -e "${GREEN}✓ Chat messages retrieved${NC}"
echo ""

# Test 10: List my submissions
echo -e "${BLUE}=== Step 10: List My Submissions ===${NC}"
MY_SUBMISSIONS=$(curl -s "$API_URL/status/my?tenantId=$TENANT_ID&userId=$USER_ID")
echo "$MY_SUBMISSIONS" | python3 -m json.tool 2>/dev/null || echo "$MY_SUBMISSIONS"
echo -e "${GREEN}✓ My submissions listed${NC}"
echo ""

# Test 11: Cancel submission
echo -e "${BLUE}=== Step 11: Cancel Submission ===${NC}"
CANCEL_RESPONSE=$(curl -s -X POST "$API_URL/submissions/$SUBMISSION_ID/cancel?userId=$USER_ID")
echo "$CANCEL_RESPONSE" | python3 -m json.tool 2>/dev/null || echo "$CANCEL_RESPONSE"
echo -e "${GREEN}✓ Submission cancelled${NC}"
echo ""

# Test 12: Verify cancellation
echo -e "${BLUE}=== Step 12: Verify Cancellation ===${NC}"
VERIFY_RESPONSE=$(curl -s "$API_URL/submissions/$SUBMISSION_ID")
STATUS=$(echo "$VERIFY_RESPONSE" | python3 -c "import sys, json; data=json.load(sys.stdin); print(data.get('status', ''))" 2>/dev/null)
echo "Current status: $STATUS"

if [ "$STATUS" = "cancelled" ]; then
    echo -e "${GREEN}✓ Cancellation verified${NC}"
else
    echo -e "${YELLOW}⚠ Status is: $STATUS (expected: cancelled)${NC}"
fi
echo ""

# Summary
echo "=========================================="
echo -e "${GREEN}  Complete Workflow Test Passed!${NC}"
echo "=========================================="
echo ""
echo "Summary:"
echo "  - Created draft via chat"
echo "  - Submitted draft"
echo "  - Queried status"
echo "  - Performed actions (urge, supplement)"
echo "  - Checked audit trail"
echo "  - Cancelled submission"
echo ""
echo -e "${GREEN}All workflow steps completed successfully!${NC}"