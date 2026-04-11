#!/bin/bash

# LLM Setup Wizard
# Interactive script to configure LLM providers

set -e

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

echo ""
echo -e "${CYAN}=========================================="
echo "  LLM Setup Wizard"
echo "==========================================${NC}"
echo ""

echo "This wizard will help you configure LLM integration."
echo ""

# Check if .env exists
if [ ! -f .env ]; then
    echo -e "${RED}✗ .env file not found${NC}"
    echo "Please create .env file first"
    exit 1
fi

# Show current configuration
echo -e "${BLUE}=== Current Configuration ===${NC}"
echo ""
CURRENT_PROVIDER=$(grep LLM_PROVIDER .env | cut -d'=' -f2)
CURRENT_USE_LLM=$(grep USE_LLM_FOR_INTENT .env | cut -d'=' -f2)
echo "Provider: $CURRENT_PROVIDER"
echo "Use LLM: $CURRENT_USE_LLM"
echo ""

# Ask which provider to use
echo -e "${BLUE}=== Select LLM Provider ===${NC}"
echo ""
echo "1) OpenAI (GPT-4, GPT-3.5)"
echo "2) Anthropic (Claude 3.5)"
echo "3) Ollama (Local, Free)"
echo "4) Disable LLM (Use rule-based matching)"
echo ""
read -p "Select option (1-4): " OPTION

case $OPTION in
    1)
        echo ""
        echo -e "${BLUE}=== OpenAI Configuration ===${NC}"
        echo ""
        echo "Get your API key from: https://platform.openai.com/api-keys"
        echo ""
        read -p "Enter OpenAI API Key: " API_KEY

        if [ -z "$API_KEY" ]; then
            echo -e "${RED}✗ API Key cannot be empty${NC}"
            exit 1
        fi

        echo ""
        echo "Select model:"
        echo "1) gpt-4-turbo-preview (Recommended, ~$0.01/request)"
        echo "2) gpt-4 (~$0.03/request)"
        echo "3) gpt-3.5-turbo (Fast, ~$0.0005/request)"
        echo ""
        read -p "Select model (1-3): " MODEL_OPTION

        case $MODEL_OPTION in
            1) MODEL="gpt-4-turbo-preview" ;;
            2) MODEL="gpt-4" ;;
            3) MODEL="gpt-3.5-turbo" ;;
            *) MODEL="gpt-4-turbo-preview" ;;
        esac

        # Update .env
        sed -i.bak "s|^LLM_PROVIDER=.*|LLM_PROVIDER=openai|" .env
        sed -i.bak "s|^USE_LLM_FOR_INTENT=.*|USE_LLM_FOR_INTENT=true|" .env
        sed -i.bak "s|^OPENAI_API_KEY=.*|OPENAI_API_KEY=$API_KEY|" .env
        sed -i.bak "s|^OPENAI_MODEL=.*|OPENAI_MODEL=$MODEL|" .env

        echo ""
        echo -e "${GREEN}✓ OpenAI configured successfully${NC}"
        echo ""
        echo "Testing API connection..."
        ./scripts/test-llm-provider.sh openai
        ;;

    2)
        echo ""
        echo -e "${BLUE}=== Anthropic Configuration ===${NC}"
        echo ""
        echo "Get your API key from: https://console.anthropic.com/"
        echo ""
        read -p "Enter Anthropic API Key: " API_KEY

        if [ -z "$API_KEY" ]; then
            echo -e "${RED}✗ API Key cannot be empty${NC}"
            exit 1
        fi

        echo ""
        echo "Select model:"
        echo "1) claude-3-5-sonnet-20241022 (Recommended)"
        echo "2) claude-3-opus-20240229 (Most capable)"
        echo "3) claude-3-haiku-20240307 (Fastest)"
        echo ""
        read -p "Select model (1-3): " MODEL_OPTION

        case $MODEL_OPTION in
            1) MODEL="claude-3-5-sonnet-20241022" ;;
            2) MODEL="claude-3-opus-20240229" ;;
            3) MODEL="claude-3-haiku-20240307" ;;
            *) MODEL="claude-3-5-sonnet-20241022" ;;
        esac

        # Update .env - uncomment Anthropic lines
        sed -i.bak "s|^LLM_PROVIDER=.*|LLM_PROVIDER=anthropic|" .env
        sed -i.bak "s|^USE_LLM_FOR_INTENT=.*|USE_LLM_FOR_INTENT=true|" .env
        sed -i.bak "s|^# ANTHROPIC_API_KEY=.*|ANTHROPIC_API_KEY=$API_KEY|" .env
        sed -i.bak "s|^# ANTHROPIC_BASE_URL=.*|ANTHROPIC_BASE_URL=https://api.anthropic.com|" .env
        sed -i.bak "s|^# ANTHROPIC_MODEL=.*|ANTHROPIC_MODEL=$MODEL|" .env

        echo ""
        echo -e "${GREEN}✓ Anthropic configured successfully${NC}"
        echo ""
        echo "Testing API connection..."
        ./scripts/test-llm-provider.sh anthropic
        ;;

    3)
        echo ""
        echo -e "${BLUE}=== Ollama Configuration ===${NC}"
        echo ""

        # Check if Ollama is installed
        if ! command -v ollama &> /dev/null; then
            echo -e "${YELLOW}⚠ Ollama is not installed${NC}"
            echo ""
            echo "Install Ollama:"
            echo "  macOS: brew install ollama"
            echo "  Linux: curl -fsSL https://ollama.com/install.sh | sh"
            echo "  Or visit: https://ollama.com/"
            exit 1
        fi

        echo "Ollama is installed ✓"
        echo ""

        # Check if Ollama is running
        if ! curl -s http://localhost:11434/api/tags > /dev/null 2>&1; then
            echo "Starting Ollama..."
            ollama serve &
            sleep 2
        fi

        echo "Select model:"
        echo "1) llama2 (7B, Recommended)"
        echo "2) mistral (7B, Fast)"
        echo "3) qwen (7B, Chinese-friendly)"
        echo "4) deepseek-coder (Code-focused)"
        echo ""
        read -p "Select model (1-4): " MODEL_OPTION

        case $MODEL_OPTION in
            1) MODEL="llama2" ;;
            2) MODEL="mistral" ;;
            3) MODEL="qwen" ;;
            4) MODEL="deepseek-coder" ;;
            *) MODEL="llama2" ;;
        esac

        echo ""
        echo "Checking if model is available..."
        if ! curl -s http://localhost:11434/api/tags | grep -q "\"name\":\"$MODEL\""; then
            echo "Downloading model (this may take a few minutes)..."
            ollama pull $MODEL
        fi

        # Update .env
        sed -i.bak "s|^LLM_PROVIDER=.*|LLM_PROVIDER=ollama|" .env
        sed -i.bak "s|^USE_LLM_FOR_INTENT=.*|USE_LLM_FOR_INTENT=true|" .env
        sed -i.bak "s|^# OLLAMA_BASE_URL=.*|OLLAMA_BASE_URL=http://localhost:11434|" .env
        sed -i.bak "s|^# OLLAMA_MODEL=.*|OLLAMA_MODEL=$MODEL|" .env

        echo ""
        echo -e "${GREEN}✓ Ollama configured successfully${NC}"
        echo ""
        echo "Testing API connection..."
        ./scripts/test-llm-provider.sh ollama
        ;;

    4)
        echo ""
        echo -e "${BLUE}=== Disabling LLM ===${NC}"
        echo ""

        # Update .env
        sed -i.bak "s|^USE_LLM_FOR_INTENT=.*|USE_LLM_FOR_INTENT=false|" .env

        echo -e "${GREEN}✓ LLM disabled${NC}"
        echo ""
        echo "The system will use rule-based matching for intent detection."
        echo "This is fast, free, and works well for simple scenarios."
        ;;

    *)
        echo -e "${RED}✗ Invalid option${NC}"
        exit 1
        ;;
esac

# Clean up backup files
rm -f .env.bak

echo ""
echo -e "${CYAN}=========================================="
echo "  Setup Complete"
echo "==========================================${NC}"
echo ""
echo "Next steps:"
echo ""
echo "1. Restart the API server:"
echo "   cd apps/api"
echo "   pnpm dev"
echo ""
echo "2. Test the chat endpoint:"
echo "   ./scripts/test-llm-integration.sh"
echo ""
echo "3. View configuration guide:"
echo "   cat LLM_CONFIGURATION_GUIDE.md"
echo ""
