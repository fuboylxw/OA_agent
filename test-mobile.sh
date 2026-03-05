#!/bin/bash

# 移动端适配一键测试脚本
# 使用方法: ./test-mobile.sh

echo "📱 对话工作台移动端适配测试工具"
echo "=================================="
echo ""

# 检查开发服务器是否运行
if lsof -Pi :3000 -sTCP:LISTEN -t >/dev/null ; then
    echo "✅ 开发服务器正在运行 (端口 3000)"
else
    echo "❌ 开发服务器未运行"
    echo "请先启动开发服务器: cd apps/web && npm run dev"
    exit 1
fi

echo ""
echo "🔍 可用的测试选项:"
echo ""
echo "1. 打开测试清单页面"
echo "2. 打开可视化演示页面"
echo "3. 打开对话工作台（移动端视口）"
echo "4. 打开对话工作台（桌面端视口）"
echo "5. 查看适配报告"
echo "6. 运行自动检测脚本"
echo "7. 全部打开"
echo "0. 退出"
echo ""

read -p "请选择 (0-7): " choice

case $choice in
    1)
        echo "📋 打开测试清单页面..."
        open "$(pwd)/mobile-test.html"
        ;;
    2)
        echo "🎨 打开可视化演示页面..."
        open "$(pwd)/mobile-demo.html"
        ;;
    3)
        echo "📱 打开对话工作台（移动端视口）..."
        echo ""
        echo "提示: 请在浏览器中按 Cmd+Option+I 打开 DevTools"
        echo "      然后按 Cmd+Shift+M 切换到设备模式"
        echo "      选择 iPhone 14 (390×844) 进行测试"
        open "http://localhost:3000/chat"
        ;;
    4)
        echo "🖥️ 打开对话工作台（桌面端视口）..."
        open "http://localhost:3000/chat"
        ;;
    5)
        echo "📄 查看适配报告..."
        if command -v code &> /dev/null; then
            code "$(pwd)/MOBILE_ADAPTATION_REPORT.md"
        else
            open "$(pwd)/MOBILE_ADAPTATION_REPORT.md"
        fi
        ;;
    6)
        echo "🔬 准备运行自动检测脚本..."
        echo ""
        echo "请按以下步骤操作:"
        echo "1. 在浏览器中打开 http://localhost:3000/chat"
        echo "2. 按 F12 或 Cmd+Option+I 打开控制台"
        echo "3. 复制以下脚本到控制台运行:"
        echo ""
        cat verify-mobile-adaptation.js
        echo ""
        echo "脚本已复制到剪贴板（如果支持）"
        cat verify-mobile-adaptation.js | pbcopy 2>/dev/null || echo "请手动复制上面的脚本"
        ;;
    7)
        echo "🚀 打开所有测试页面..."
        open "$(pwd)/mobile-test.html"
        sleep 1
        open "$(pwd)/mobile-demo.html"
        sleep 1
        open "http://localhost:3000/chat"
        echo ""
        echo "✅ 所有页面已打开"
        ;;
    0)
        echo "👋 退出测试工具"
        exit 0
        ;;
    *)
        echo "❌ 无效选择"
        exit 1
        ;;
esac

echo ""
echo "✅ 完成"
echo ""
echo "💡 测试提示:"
echo "  - 使用 Chrome DevTools 的设备模式测试移动端"
echo "  - 测试设备: iPhone 14 (390×844), iPhone SE (375×667)"
echo "  - 测试极窄屏: 手动输入宽度 320px"
echo "  - 测试桌面端: 窗口宽度 ≥ 1280px"
echo "  - 观察 1024px 断点处的响应式切换"
echo ""
