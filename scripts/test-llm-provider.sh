#!/bin/bash

# Test LLM Provider
# Usage: ./scripts/test-llm-provider.sh [provider]
# Example: ./scripts/test-llm-provider.sh openai

set -e

PROVIDER=${1:-$(grep LLM_PROVIDER .env | cut -d'=' -f2)}

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

echo ""
echo -e "${CYAN}=========================================="
echo "  Testing LLM Provider: $PROVIDER"
echo "==========================================${NC}"
echo ""

case $PROVIDER in
    openai)
        echo -e "${BLUE}=== Testing OpenAI ===${NC}"
        echo ""

        if [ -f .env ]; then
            API_KEY=$(grep OPENAI_API_KEY .env | cut -d'=' -f2)
            BASE_URL=$(grep OPENAI_BASE_URL .env | cut -d'=' -f2)
            MODEL=$(grep OPENAI_MODEL .env | cut -d'=' -f2)

            echo "Base URL: $BASE_URL"
            echo "Model: $MODEL"
            echo "API Key: ${API_KEY:0:10}...${API_KEY: -4}"
            echo ""

            echo "Testing API connection..."
            echo ""

            RESPONSE=$(curl -s -m 10 "$BASE_URL/chat/completions" \
              -H "Content-Type: application/json" \
              -H "Authorization: Bearer $API_KEY" \
              -d "{
                \"model\": \"$MODEL\",
                \"messages\": [{\"role\": \"user\", \"content\": \"Say 'Hello' in Chinese\"}],
                \"max_tokens\": 20
              }" 2>&1)

            if echo "$RESPONSE" | grep -q "error"; then
                echo -e "${RED}✗ API Test Failed${NC}"
                echo ""
                echo "$RESPONSE" | python3 -m json.tool 2>/dev/null || echo "$RESPONSE"
                echo ""
                echo -e "${YELLOW}Possible issues:${NC}"
                echo "1. Invalid API key"
                echo "2. Invalid model name (current: $MODEL)"
                echo "3. Insufficient quota"
                echo "4. Network connectivity"
                echo ""
                echo -e "${YELLOW}Valid OpenAI models:${NC}"
                echo "- gpt-4-turbo-preview"
                echo "- gpt-4"
                echo "- gpt-3.5-turbo"
                echo ""
                echo "Get API key from: https://platform.openai.com/api-keys"
                exit 1
            else
                echo -e "${GREEN}✓ API Test Passed${NC}"
                echo ""
                echo "Response:"
                echo "$RESPONSE" | python3 -m json.tool 2>/dev/null | head -30
            fi
        else
            echo -e "${RED}✗ .env file not found${NC}"
            exit 1
        fi
        ;;

    anthropic)
        echo -e "${BLUE}=== Testing Anthropic (Claude) ===${NC}"
        echo ""

        if [ -f .env ]; then
            API_KEY=$(grep ANTHROPIC_API_KEY .env | cut -d'=' -f2 | sed 's/#.*//' | xargs)
            BASE_URL=$(grep ANTHROPIC_BASE_URL .env | cut -d'=' -f2 | sed 's/#.*//' | xargs)
            MODEL=$(grep ANTHROPIC_MODEL .env | cut -d'=' -f2 | sed 's/#.*//' | xargs)

            if [ -z "$API_KEY" ] || [ "$API_KEY" = "your-anthropic-api-key" ]; then
                echo -e "${RED}✗ ANTHROPIC_API_KEY not configured${NC}"
                echo ""
                echo "Please update .env file:"
                echo "  ANTHROPIC_API_KEY=sk-ant-your-key-here"
                echo "  ANTHROPIC_BASE_URL=https://api.anthropic.com"
                echo "  ANTHROPIC_MODEL=claude-3-5-sonnet-20241022"
                echo ""
                echo "Get API key from: https://console.anthropic.com/"
                exit 1
            fi

            echo "Base URL: $BASE_URL"
            echo "Model: $MODEL"
            echo "API Key: ${API_KEY:0:10}...${API_KEY: -4}"
            echo ""

            echo "Testing API connection..."
            echo ""

            RESPONSE=$(curl -s -m 10 "$BASE_URL/v1/messages" \
              -H "Content-Type: application/json" \
              -H "x-api-key: $API_KEY" \
              -H "anthropic-version: 2023-06-01" \
              -d "{
                \"model\": \"$MODEL\",
                \"messages\": [{\"role\": \"user\", \"content\": \"Say 'Hello' in Chinese\"}],
                \"max_tokens\": 20
              }" 2>&1)

            if echo "$RESPONSE" | grep -q "error"; then
                echo -e "${RED}✗ API Test Failed${NC}"
                echo ""
                echo "$RESPONSE" | python3 -m json.tool 2>/dev/null || echo "$RESPONSE"
                echo ""
                echo "Get API key from: https://console.anthropic.com/"
                exit 1
            else
                echo -e "${GREEN}✓ API Test Passed${NC}"
                echo ""
                echo "Response:"
                echo "$RESPONSE" | python3 -m json.tool 2>/dev/null | head -30
            fi
        else
            echo -e "${RED}✗ .env file not found${NC}"
            exit 1
        fi
        ;;

    ollama)
        echo -e "${BLUE}=== Testing Ollama (Local) ===${NC}"
        echo ""

        if [ -f .env ]; then
            BASE_URL=$(grep OLLAMA_BASE_URL .env | cut -d'=' -f2 | sed 's/#.*//' | xargs)
            MODEL=$(grep OLLAMA_MODEL .env | cut -d'=' -f2 | sed 's/#.*//' | xargs)

            if [ -z "$BASE_URL" ]; then
                BASE_URL="http://localhost:11434"
            fi

            if [ -z "$MODEL" ]; then
                MODEL="llama2"
            fi

            echo "Base URL: $BASE_URL"
            echo "Model: $MODEL"
            echo ""

            echo "Checking if Ollama is running..."
            if ! curl -s "$BASE_URL/api/tags" > /dev/null 2>&1; then
                echo -e "${RED}✗ Ollama is not running${NC}"
                echo ""
                echo "Please start Ollama:"
                echo "  ollama serve"
                echo ""
                echo "If Ollama is not installed:"
                echo "  brew install ollama  # macOS"
                echo "  # or visit: https://ollama.com/"
                exit 1
            fi

            echo -e "${GREEN}✓ Ollama is running${NC}"
            echo ""

            echo "Checking if model is available..."
            if ! curl -s "$BASE_URL/api/tags" | grep -q "\"name\":\"$MODEL\""; then
                echo -e "${YELLOW}⚠ Model '$MODEL' not found${NC}"
                echo ""
                echo "Available models:"
                curl -s "$BASE_URL/api/tags" | python3 -c "import sys, json; data=json.load(sys.stdin); [print(f\"  - {m['name']}\") for m in data.get('models', [])]" 2>/dev/null
                echo ""
                echo "To download the model:"
                echo "  ollama pull $MODEL"
                exit 1
            fi

            echo -e "${GREEN}✓ Model '$MODEL' is available${NC}"
            echo ""

            echo "Testing API connection..."
            echo ""

            RESPONSE=$(curl -s -m 30 "$BASE_URL/api/chat" \
              -H "Content-Type: application/json" \
              -d "{
                \"model\": \"$MODEL\",
                \"messages\": [{\"role\": \"user\", \"content\": \"Say 'Hello' in Chinese\"}],
                \"stream\": false
              }" 2>&1)

            if echo "$RESPONSE" | grep -q "error"; then
                echo -e "${RED}✗ API Test Failed${NC}"
                echo ""
                echo "$RESPONSE"
                exit 1
            else
                echo -e "${GREEN}✓ API Test Passed${NC}"
                echo ""
                echo "Response:"
                echo "$RESPONSE" | python3 -m json.tool 2>/dev/null | head -30
            fi
        else
            echo -e "${RED}✗ .env file not found${NC}"
            exit 1
        fi
        ;;

    *)
        echo -e "${RED}✗ Unknown provider: $PROVIDER${NC}"
        echo ""
        echo "Supported providers:"
        echo "  - openai"
        echo "  - anthropic"
        echo "  - ollama"
        echo ""
        echo "Usage: ./scripts/test-llm-provider.sh [provider]"
        exit 1
        ;;
esac

echo ""
echo -e "${CYAN}=========================================="
echo "  Provider Test Complete"
echo "==========================================${NC}"
echo ""
echo -e "${GREEN}✓ $PROVIDER is working correctly!${NC}"
echo ""
echo "Next steps:"
echo "1. Update .env to use this provider:"
echo "   LLM_PROVIDER=$PROVIDER"
echo "   USE_LLM_FOR_INTENT=true"
echo ""
echo "2. Restart the API server:"
echo "   cd apps/api && pnpm dev"
echo ""
echo "3. Test the chat endpoint:"
echo "   ./scripts/test-llm-integration.sh"
echo ""
