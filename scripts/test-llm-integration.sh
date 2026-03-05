#!/bin/bash

# Test LLM Integration
# Usage: ./scripts/test-llm-integration.sh

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

echo ""
echo -e "${CYAN}=========================================="
echo "  LLM Integration Test"
echo "==========================================${NC}"
echo ""

# Check API status
echo -n "Checking API server... "
if curl -s "$API_URL/health" > /dev/null 2>&1; then
    echo -e "${GREEN}✓ Running${NC}"
else
    echo -e "${RED}✗ Not running${NC}"
    echo "Please start the API server first: cd apps/api && pnpm dev"
    exit 1
fi
echo ""

# Check LLM configuration
echo -e "${BLUE}=== LLM Configuration ===${NC}"
echo ""

if [ -f .env ]; then
    echo "LLM Provider: $(grep LLM_PROVIDER .env | cut -d'=' -f2)"
    echo "Use LLM for Intent: $(grep USE_LLM_FOR_INTENT .env | cut -d'=' -f2)"

    PROVIDER=$(grep LLM_PROVIDER .env | cut -d'=' -f2)

    case $PROVIDER in
        openai)
            echo "OpenAI Model: $(grep OPENAI_MODEL .env | cut -d'=' -f2)"
            echo "OpenAI Base URL: $(grep OPENAI_BASE_URL .env | cut -d'=' -f2)"
            ;;
        anthropic)
            echo "Anthropic Model: $(grep ANTHROPIC_MODEL .env | cut -d'=' -f2)"
            ;;
        azure-openai)
            echo "Azure Deployment: $(grep AZURE_OPENAI_DEPLOYMENT .env | cut -d'=' -f2)"
            ;;
        ollama)
            echo "Ollama Model: $(grep OLLAMA_MODEL .env | cut -d'=' -f2)"
            echo "Ollama Base URL: $(grep OLLAMA_BASE_URL .env | cut -d'=' -f2)"
            ;;
    esac
else
    echo -e "${YELLOW}⚠ .env file not found${NC}"
fi
echo ""

# Test 1: Intent Detection - Create Submission
echo -e "${BLUE}=== Test 1: Intent Detection (Create Submission) ===${NC}"
echo ""
echo "Message: 我要报销差旅费2000元，事由是参加技术会议，日期2026-03-20"
echo ""

RESPONSE=$(curl -s -X POST "$API_URL/assistant/chat" \
  -H "Content-Type: application/json" \
  -d '{
    "message": "我要报销差旅费2000元，事由是参加技术会议，日期2026-03-20",
    "userId": "'$USER_ID'"
  }')

echo "$RESPONSE" | python3 -m json.tool 2>/dev/null | head -30

INTENT=$(echo "$RESPONSE" | python3 -c "import sys, json; data=json.load(sys.stdin); print(data.get('intent', 'unknown'))" 2>/dev/null)
DRAFT_ID=$(echo "$RESPONSE" | python3 -c "import sys, json; data=json.load(sys.stdin); print(data.get('draftId', ''))" 2>/dev/null)

if [ "$INTENT" = "create_submission" ] && [ -n "$DRAFT_ID" ]; then
    echo ""
    echo -e "${GREEN}✓ Test 1 Passed${NC} - Intent: $INTENT, Draft ID: $DRAFT_ID"
else
    echo ""
    echo -e "${RED}✗ Test 1 Failed${NC} - Intent: $INTENT"
fi
echo ""

# Test 2: Intent Detection - Query Status
echo -e "${BLUE}=== Test 2: Intent Detection (Query Status) ===${NC}"
echo ""
echo "Message: 我的申请到哪了？"
echo ""

RESPONSE=$(curl -s -X POST "$API_URL/assistant/chat" \
  -H "Content-Type: application/json" \
  -d '{
    "message": "我的申请到哪了？",
    "userId": "'$USER_ID'"
  }')

echo "$RESPONSE" | python3 -m json.tool 2>/dev/null | head -20

INTENT=$(echo "$RESPONSE" | python3 -c "import sys, json; data=json.load(sys.stdin); print(data.get('intent', 'unknown'))" 2>/dev/null)

if [ "$INTENT" = "query_status" ] || [ -n "$(echo "$RESPONSE" | grep '申请')" ]; then
    echo ""
    echo -e "${GREEN}✓ Test 2 Passed${NC}"
else
    echo ""
    echo -e "${RED}✗ Test 2 Failed${NC}"
fi
echo ""

# Test 3: Intent Detection - Service Request
echo -e "${BLUE}=== Test 3: Intent Detection (Service Request) ===${NC}"
echo ""
echo "Message: 有什么流程可以办理？"
echo ""

RESPONSE=$(curl -s -X POST "$API_URL/assistant/chat" \
  -H "Content-Type: application/json" \
  -d '{
    "message": "有什么流程可以办理？",
    "userId": "'$USER_ID'"
  }')

echo "$RESPONSE" | python3 -m json.tool 2>/dev/null | head -20

if echo "$RESPONSE" | grep -q "流程"; then
    echo ""
    echo -e "${GREEN}✓ Test 3 Passed${NC}"
else
    echo ""
    echo -e "${RED}✗ Test 3 Failed${NC}"
fi
echo ""

# Test 4: Intent Detection - Cancel
echo -e "${BLUE}=== Test 4: Intent Detection (Cancel) ===${NC}"
echo ""
echo "Message: 撤回我的申请"
echo ""

RESPONSE=$(curl -s -X POST "$API_URL/assistant/chat" \
  -H "Content-Type: application/json" \
  -d '{
    "message": "撤回我的申请",
    "userId": "'$USER_ID'"
  }')

echo "$RESPONSE" | python3 -m json.tool 2>/dev/null | head -20

if echo "$RESPONSE" | grep -q "申请编号"; then
    echo ""
    echo -e "${GREEN}✓ Test 4 Passed${NC}"
else
    echo ""
    echo -e "${RED}✗ Test 4 Failed${NC}"
fi
echo ""

# Summary
echo -e "${CYAN}=========================================="
echo "  Test Summary"
echo "==========================================${NC}"
echo ""
echo "All intent detection tests completed!"
echo ""
echo "Note: If USE_LLM_FOR_INTENT=false, the system uses rule-based matching."
echo "      If USE_LLM_FOR_INTENT=true, the system uses LLM for intent detection."
echo ""
echo "To switch between modes, update .env:"
echo "  USE_LLM_FOR_INTENT=true   # Use LLM"
echo "  USE_LLM_FOR_INTENT=false  # Use rules"
echo ""
echo "For more information, see: LLM_CONFIGURATION_GUIDE.md"
echo ""
