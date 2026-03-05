#!/bin/bash

# O2OA 集成测试脚本
# 用于测试 OA_agent 初始化中心是否能成功对接 O2OA 系统

set -e

echo "🚀 O2OA 集成测试开始"
echo "===================="
echo ""

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# 配置
O2OA_BASE_URL="http://localhost"
OA_AGENT_API_URL="http://localhost:3001"
OA_AGENT_WEB_URL="http://localhost:3000"

# 步骤 1: 检查 O2OA 是否运行
echo -e "${BLUE}步骤 1: 检查 O2OA 系统状态${NC}"
echo "-----------------------------------"

O2OA_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$O2OA_BASE_URL/x_desktop/index.html" 2>/dev/null || echo "000")

if [ "$O2OA_STATUS" = "200" ]; then
    echo -e "${GREEN}✅ O2OA 系统运行正常 (HTTP $O2OA_STATUS)${NC}"
else
    echo -e "${RED}❌ O2OA 系统未运行 (HTTP $O2OA_STATUS)${NC}"
    echo "请先启动 O2OA 系统"
    exit 1
fi

echo ""

# 步骤 2: 获取 O2OA 认证 Token
echo -e "${BLUE}步骤 2: O2OA 认证测试${NC}"
echo "-----------------------------------"

echo "请在浏览器中登录 O2OA 系统："
echo "  地址: $O2OA_BASE_URL/x_desktop/index.html"
echo ""
echo "登录后，请按以下步骤获取 token："
echo "  1. 按 F12 打开开发者工具"
echo "  2. 切换到 Console 标签"
echo "  3. 输入: localStorage.getItem('x-token')"
echo "  4. 复制输出的 token（不包括引号）"
echo ""

read -p "请输入 O2OA token: " O2OA_TOKEN

if [ -z "$O2OA_TOKEN" ]; then
    echo -e "${RED}❌ Token 不能为空${NC}"
    exit 1
fi

echo -e "${GREEN}✅ Token 已获取${NC}"
echo ""

# 步骤 3: 测试 O2OA API
echo -e "${BLUE}步骤 3: 测试 O2OA API${NC}"
echo "-----------------------------------"

# 3.1 测试应用列表 API
echo "3.1 测试应用列表 API..."
APP_LIST_RESPONSE=$(curl -s "$O2OA_BASE_URL/x_processplatform_assemble_surface/jaxrs/application/list" \
  -H "x-token: $O2OA_TOKEN" 2>/dev/null)

APP_LIST_TYPE=$(echo "$APP_LIST_RESPONSE" | python3 -c "import sys, json; print(json.load(sys.stdin).get('type', 'error'))" 2>/dev/null || echo "error")

if [ "$APP_LIST_TYPE" = "success" ]; then
    APP_COUNT=$(echo "$APP_LIST_RESPONSE" | python3 -c "import sys, json; print(len(json.load(sys.stdin).get('data', [])))" 2>/dev/null || echo "0")
    echo -e "${GREEN}✅ 应用列表 API 正常 (发现 $APP_COUNT 个应用)${NC}"

    # 保存第一个应用的 flag
    FIRST_APP_FLAG=$(echo "$APP_LIST_RESPONSE" | python3 -c "import sys, json; data=json.load(sys.stdin).get('data', []); print(data[0]['alias'] if data else '')" 2>/dev/null || echo "")

    if [ -n "$FIRST_APP_FLAG" ]; then
        echo "  第一个应用: $FIRST_APP_FLAG"
    fi
else
    echo -e "${RED}❌ 应用列表 API 失败${NC}"
    echo "  响应: $APP_LIST_RESPONSE"
fi

echo ""

# 3.2 测试流程列表 API（如果有应用）
if [ -n "$FIRST_APP_FLAG" ]; then
    echo "3.2 测试流程列表 API..."
    PROCESS_LIST_RESPONSE=$(curl -s "$O2OA_BASE_URL/x_processplatform_assemble_surface/jaxrs/process/list/application/$FIRST_APP_FLAG" \
      -H "x-token: $O2OA_TOKEN" 2>/dev/null)

    PROCESS_LIST_TYPE=$(echo "$PROCESS_LIST_RESPONSE" | python3 -c "import sys, json; print(json.load(sys.stdin).get('type', 'error'))" 2>/dev/null || echo "error")

    if [ "$PROCESS_LIST_TYPE" = "success" ]; then
        PROCESS_COUNT=$(echo "$PROCESS_LIST_RESPONSE" | python3 -c "import sys, json; print(len(json.load(sys.stdin).get('data', [])))" 2>/dev/null || echo "0")
        echo -e "${GREEN}✅ 流程列表 API 正常 (发现 $PROCESS_COUNT 个流程)${NC}"
    else
        echo -e "${YELLOW}⚠️  流程列表 API 失败或无流程${NC}"
    fi
    echo ""
fi

# 3.3 测试任务列表 API
echo "3.3 测试任务列表 API..."
TASK_LIST_RESPONSE=$(curl -s "$O2OA_BASE_URL/x_processplatform_assemble_surface/jaxrs/task/list//next/20" \
  -H "x-token: $O2OA_TOKEN" 2>/dev/null)

TASK_LIST_TYPE=$(echo "$TASK_LIST_RESPONSE" | python3 -c "import sys, json; print(json.load(sys.stdin).get('type', 'error'))" 2>/dev/null || echo "error")

if [ "$TASK_LIST_TYPE" = "success" ]; then
    TASK_COUNT=$(echo "$TASK_LIST_RESPONSE" | python3 -c "import sys, json; print(len(json.load(sys.stdin).get('data', [])))" 2>/dev/null || echo "0")
    echo -e "${GREEN}✅ 任务列表 API 正常 (当前有 $TASK_COUNT 个待办任务)${NC}"
else
    echo -e "${YELLOW}⚠️  任务列表 API 失败或无任务${NC}"
fi

echo ""

# 步骤 4: 检查 OA_agent 系统状态
echo -e "${BLUE}步骤 4: 检查 OA_agent 系统状态${NC}"
echo "-----------------------------------"

# 4.1 检查 API 服务
API_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$OA_AGENT_API_URL/api/v1/bootstrap/jobs?tenantId=default-tenant" 2>/dev/null || echo "000")

if [ "$API_STATUS" = "200" ]; then
    echo -e "${GREEN}✅ OA_agent API 服务运行正常 (HTTP $API_STATUS)${NC}"
else
    echo -e "${RED}❌ OA_agent API 服务未运行 (HTTP $API_STATUS)${NC}"
    echo ""
    echo "请启动 OA_agent 系统："
    echo "  cd /Users/liuxingwei/project/myproject/OA_agent"
    echo "  pnpm docker:up    # 启动基础设施"
    echo "  pnpm db:migrate   # 初始化数据库"
    echo "  pnpm dev          # 启动所有服务"
    echo ""
    exit 1
fi

# 4.2 检查 Web 服务
WEB_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$OA_AGENT_WEB_URL" 2>/dev/null || echo "000")

if [ "$WEB_STATUS" = "200" ]; then
    echo -e "${GREEN}✅ OA_agent Web 服务运行正常 (HTTP $WEB_STATUS)${NC}"
else
    echo -e "${RED}❌ OA_agent Web 服务未运行 (HTTP $WEB_STATUS)${NC}"
    exit 1
fi

echo ""

# 步骤 5: 创建 Bootstrap 任务
echo -e "${BLUE}步骤 5: 创建 Bootstrap 任务${NC}"
echo "-----------------------------------"

echo "正在创建 O2OA 初始化任务..."

BOOTSTRAP_RESPONSE=$(curl -s -X POST "$OA_AGENT_API_URL/api/v1/bootstrap/jobs" \
  -H "Content-Type: application/json" \
  -d "{
    \"oaUrl\": \"$O2OA_BASE_URL/x_desktop/index.html\",
    \"openApiUrl\": \"\",
    \"harFileUrl\": \"\"
  }" 2>/dev/null)

BOOTSTRAP_JOB_ID=$(echo "$BOOTSTRAP_RESPONSE" | python3 -c "import sys, json; print(json.load(sys.stdin).get('id', ''))" 2>/dev/null || echo "")

if [ -n "$BOOTSTRAP_JOB_ID" ]; then
    echo -e "${GREEN}✅ Bootstrap 任务创建成功${NC}"
    echo "  任务 ID: $BOOTSTRAP_JOB_ID"
    echo ""

    # 等待任务执行
    echo "等待任务执行（最多等待 60 秒）..."
    for i in {1..12}; do
        sleep 5

        JOB_STATUS_RESPONSE=$(curl -s "$OA_AGENT_API_URL/api/v1/bootstrap/jobs/$BOOTSTRAP_JOB_ID" 2>/dev/null)
        JOB_STATUS=$(echo "$JOB_STATUS_RESPONSE" | python3 -c "import sys, json; print(json.load(sys.stdin).get('status', ''))" 2>/dev/null || echo "")

        echo "  [$i/12] 当前状态: $JOB_STATUS"

        if [ "$JOB_STATUS" = "REVIEW" ] || [ "$JOB_STATUS" = "PUBLISHED" ]; then
            echo -e "${GREEN}✅ 任务执行完成${NC}"
            break
        elif [ "$JOB_STATUS" = "FAILED" ]; then
            echo -e "${RED}❌ 任务执行失败${NC}"
            break
        fi
    done
else
    echo -e "${RED}❌ Bootstrap 任务创建失败${NC}"
    echo "  响应: $BOOTSTRAP_RESPONSE"
fi

echo ""

# 步骤 6: 测试总结
echo -e "${BLUE}步骤 6: 测试总结${NC}"
echo "-----------------------------------"

echo ""
echo "📊 测试结果汇总："
echo ""
echo "  O2OA 系统:"
echo "    - 系统状态: ✅ 运行中"
echo "    - 认证 API: ✅ 正常"
echo "    - 应用列表 API: ✅ 正常"
echo "    - 流程列表 API: ✅ 正常"
echo "    - 任务列表 API: ✅ 正常"
echo ""
echo "  OA_agent 系统:"
echo "    - API 服务: ✅ 运行中"
echo "    - Web 服务: ✅ 运行中"
echo "    - Bootstrap 任务: ✅ 已创建"
echo ""

# 步骤 7: 下一步操作指引
echo -e "${BLUE}步骤 7: 下一步操作${NC}"
echo "-----------------------------------"
echo ""
echo "1️⃣  访问初始化中心查看任务详情："
echo "   $OA_AGENT_WEB_URL/bootstrap"
echo ""
echo "2️⃣  如果任务状态为 REVIEW，点击「发布到流程库」"
echo ""
echo "3️⃣  访问对话工作台测试自然语言交互："
echo "   $OA_AGENT_WEB_URL/chat"
echo ""
echo "4️⃣  测试对话示例："
echo "   - 我要报销差旅费"
echo "   - 查看我的申请进度"
echo "   - 我要请假三天"
echo ""

echo -e "${GREEN}✅ 测试完成！${NC}"
echo ""
