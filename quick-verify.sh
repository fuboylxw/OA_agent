#!/bin/bash

# 移动端适配快速验证脚本
# 一键检查所有关键适配点

echo "🔍 移动端适配快速验证"
echo "======================="
echo ""

# 检查文件是否存在
FILE="apps/web/src/app/chat/page.tsx"

if [ ! -f "$FILE" ]; then
    echo "❌ 文件不存在: $FILE"
    exit 1
fi

echo "✅ 文件存在: $FILE"
echo ""

# 检查关键代码
echo "📝 检查关键代码..."
echo ""

# 1. 检查 sidebarOpen 状态
if grep -q "const \[sidebarOpen, setSidebarOpen\] = useState(false)" "$FILE"; then
    echo "✅ sidebarOpen 状态已添加"
else
    echo "❌ sidebarOpen 状态缺失"
fi

# 2. 检查移动端抽屉
if grep -q "Mobile Drawer Overlay" "$FILE"; then
    echo "✅ 移动端抽屉遮罩层已添加"
else
    echo "❌ 移动端抽屉遮罩层缺失"
fi

if grep -q "Mobile Drawer Panel" "$FILE"; then
    echo "✅ 移动端抽屉面板已添加"
else
    echo "❌ 移动端抽屉面板缺失"
fi

# 3. 检查汉堡按钮
if grep -q "fa-bars" "$FILE"; then
    echo "✅ 汉堡菜单图标已添加"
else
    echo "❌ 汉堡菜单图标缺失"
fi

# 4. 检查响应式网格
if grep -q "grid-cols-1 sm:grid-cols-2" "$FILE"; then
    echo "✅ 响应式网格类已更新"
else
    echo "❌ 响应式网格类未更新"
fi

# 5. 检查触控优化
if grep -q "py-3" "$FILE" | head -1; then
    echo "✅ 触控优化已应用 (py-3)"
else
    echo "⚠️  触控优化可能未完全应用"
fi

# 6. 检查安全区域
if grep -q "env(safe-area-inset-bottom" "$FILE"; then
    echo "✅ 安全区域适配已添加"
else
    echo "❌ 安全区域适配缺失"
fi

# 7. 检查 lg:hidden 类
LG_HIDDEN_COUNT=$(grep -o "lg:hidden" "$FILE" | wc -l)
echo "✅ lg:hidden 类出现 $LG_HIDDEN_COUNT 次"

# 8. 检查自动关闭逻辑
if grep -q "setSidebarOpen(false)" "$FILE"; then
    AUTO_CLOSE_COUNT=$(grep -o "setSidebarOpen(false)" "$FILE" | wc -l)
    echo "✅ 自动关闭逻辑已添加 ($AUTO_CLOSE_COUNT 处)"
else
    echo "❌ 自动关闭逻辑缺失"
fi

echo ""
echo "📊 代码统计"
echo "----------"
TOTAL_LINES=$(wc -l < "$FILE")
echo "总行数: $TOTAL_LINES"

echo ""
echo "🧪 下一步测试建议"
echo "----------------"
echo "1. 启动开发服务器: cd apps/web && npm run dev"
echo "2. 打开实时测试工具: open mobile-live-test.html"
echo "3. 或运行完整测试: ./test-mobile.sh"
echo ""
