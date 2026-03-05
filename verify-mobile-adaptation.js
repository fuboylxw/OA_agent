/**
 * 移动端适配验证脚本
 * 在浏览器控制台中运行此脚本，自动检查所有适配点
 */

(function() {
  console.log('🚀 开始移动端适配验证...\n');

  const results = {
    passed: [],
    failed: [],
    warnings: []
  };

  function pass(msg) {
    results.passed.push(msg);
    console.log('✅', msg);
  }

  function fail(msg) {
    results.failed.push(msg);
    console.error('❌', msg);
  }

  function warn(msg) {
    results.warnings.push(msg);
    console.warn('⚠️', msg);
  }

  // 1. 检查移动端抽屉元素是否存在
  console.log('\n📱 检查移动端抽屉结构...');

  const overlay = document.querySelector('.fixed.inset-0.bg-black\\/40.z-40.lg\\:hidden');
  const drawer = document.querySelector('.fixed.inset-y-0.left-0.w-72.z-50.lg\\:hidden');

  if (drawer) {
    pass('移动端抽屉面板存在');

    // 检查抽屉内容
    const closeBtn = drawer.querySelector('.fa-times');
    const newChatBtn = drawer.querySelector('.fa-plus');
    const quickActions = drawer.querySelectorAll('.fa-money-bill-wave, .fa-calendar-alt, .fa-shopping-cart, .fa-chart-bar');

    if (closeBtn) pass('抽屉关闭按钮存在');
    else fail('抽屉关闭按钮缺失');

    if (newChatBtn) pass('新建对话按钮存在');
    else fail('新建对话按钮缺失');

    if (quickActions.length === 4) pass(`快捷操作完整 (${quickActions.length}/4)`);
    else fail(`快捷操作不完整 (${quickActions.length}/4)`);

  } else {
    fail('移动端抽屉面板缺失');
  }

  // 2. 检查汉堡菜单按钮
  console.log('\n🍔 检查汉堡菜单按钮...');

  const hamburger = document.querySelector('.fa-bars');
  if (hamburger) {
    pass('汉堡菜单图标存在');

    const hamburgerBtn = hamburger.closest('button');
    if (hamburgerBtn) {
      const hasLgHidden = hamburgerBtn.classList.contains('lg:hidden');
      if (hasLgHidden) pass('汉堡按钮有 lg:hidden 类（桌面端隐藏）');
      else fail('汉堡按钮缺少 lg:hidden 类');

      // 检查触控目标大小
      const rect = hamburgerBtn.getBoundingClientRect();
      if (rect.width >= 36 && rect.height >= 36) {
        pass(`汉堡按钮尺寸合适 (${Math.round(rect.width)}×${Math.round(rect.height)}px)`);
      } else {
        warn(`汉堡按钮尺寸偏小 (${Math.round(rect.width)}×${Math.round(rect.height)}px，建议 ≥36px)`);
      }
    }
  } else {
    fail('汉堡菜单图标缺失');
  }

  // 3. 检查桌面侧边栏
  console.log('\n🖥️ 检查桌面侧边栏...');

  const desktopSidebar = document.querySelector('.w-64.bg-white.border-r.hidden.lg\\:flex');
  if (desktopSidebar) {
    pass('桌面侧边栏存在且有 hidden lg:flex 类');
  } else {
    fail('桌面侧边栏缺失或类名错误');
  }

  // 4. 检查欢迎页快捷操作网格
  console.log('\n🎯 检查欢迎页快捷操作网格...');

  const welcomeGrid = document.querySelector('.grid.grid-cols-1.sm\\:grid-cols-2');
  if (welcomeGrid) {
    pass('欢迎页网格有响应式类 (grid-cols-1 sm:grid-cols-2)');

    const gridItems = welcomeGrid.querySelectorAll('button');
    if (gridItems.length === 4) pass(`网格项数量正确 (${gridItems.length}/4)`);
    else warn(`网格项数量异常 (${gridItems.length}/4)`);
  } else {
    fail('欢迎页网格缺少响应式类');
  }

  // 5. 检查输入区域触控优化
  console.log('\n⌨️ 检查输入区域触控优化...');

  const inputArea = document.querySelector('input[type="text"]');
  const sendBtn = document.querySelector('button .fa-paper-plane')?.closest('button');

  if (inputArea) {
    const inputRect = inputArea.getBoundingClientRect();
    if (inputRect.height >= 44) {
      pass(`输入框高度合适 (${Math.round(inputRect.height)}px ≥ 44px)`);
    } else {
      fail(`输入框高度不足 (${Math.round(inputRect.height)}px < 44px)`);
    }
  } else {
    fail('输入框未找到');
  }

  if (sendBtn) {
    const btnRect = sendBtn.getBoundingClientRect();
    if (btnRect.height >= 44) {
      pass(`发送按钮高度合适 (${Math.round(btnRect.height)}px ≥ 44px)`);
    } else {
      fail(`发送按钮高度不足 (${Math.round(btnRect.height)}px < 44px)`);
    }
  } else {
    fail('发送按钮未找到');
  }

  // 6. 检查安全区域适配
  console.log('\n📐 检查安全区域适配...');

  const inputContainer = document.querySelector('.border-t.border-gray-200.bg-white.flex-shrink-0');
  if (inputContainer) {
    const style = window.getComputedStyle(inputContainer);
    const paddingBottom = style.paddingBottom;

    if (inputContainer.style.paddingBottom && inputContainer.style.paddingBottom.includes('env(safe-area-inset-bottom')) {
      pass('输入区域有安全区域适配 (env(safe-area-inset-bottom))');
    } else {
      warn('输入区域可能缺少安全区域适配');
    }
  }

  // 7. 检查当前视口和响应式状态
  console.log('\n📏 当前视口信息...');

  const width = window.innerWidth;
  const height = window.innerHeight;
  console.log(`视口尺寸: ${width}×${height}px`);

  if (width < 1024) {
    console.log('当前模式: 📱 移动端 (< 1024px)');

    if (hamburger) {
      const isVisible = window.getComputedStyle(hamburger.closest('button')).display !== 'none';
      if (isVisible) pass('汉堡按钮在移动端可见');
      else fail('汉堡按钮在移动端不可见');
    }

    if (desktopSidebar) {
      const isHidden = window.getComputedStyle(desktopSidebar).display === 'none';
      if (isHidden) pass('桌面侧边栏在移动端隐藏');
      else fail('桌面侧边栏在移动端未隐藏');
    }
  } else {
    console.log('当前模式: 🖥️ 桌面端 (≥ 1024px)');

    if (hamburger) {
      const isHidden = window.getComputedStyle(hamburger.closest('button')).display === 'none';
      if (isHidden) pass('汉堡按钮在桌面端隐藏');
      else fail('汉堡按钮在桌面端未隐藏');
    }

    if (desktopSidebar) {
      const isVisible = window.getComputedStyle(desktopSidebar).display !== 'none';
      if (isVisible) pass('桌面侧边栏在桌面端可见');
      else fail('桌面侧边栏在桌面端不可见');
    }
  }

  // 8. 输出总结
  console.log('\n' + '='.repeat(50));
  console.log('📊 验证结果总结\n');
  console.log(`✅ 通过: ${results.passed.length} 项`);
  console.log(`❌ 失败: ${results.failed.length} 项`);
  console.log(`⚠️  警告: ${results.warnings.length} 项`);
  console.log('='.repeat(50));

  if (results.failed.length === 0) {
    console.log('\n🎉 所有检查项通过！移动端适配正常。');
  } else {
    console.log('\n⚠️  发现问题，请检查失败项：');
    results.failed.forEach(msg => console.log('  -', msg));
  }

  if (results.warnings.length > 0) {
    console.log('\n💡 建议优化：');
    results.warnings.forEach(msg => console.log('  -', msg));
  }

  console.log('\n📝 手动测试建议：');
  console.log('  1. 点击汉堡按钮，检查抽屉滑入动画');
  console.log('  2. 点击遮罩层，检查抽屉关闭动画');
  console.log('  3. 在抽屉中点击快捷操作，检查自动关闭');
  console.log('  4. 调整窗口宽度到 1024px，观察断点切换');
  console.log('  5. 在 320px 宽度下检查欢迎页单列布局');

  return {
    passed: results.passed.length,
    failed: results.failed.length,
    warnings: results.warnings.length,
    details: results
  };
})();
