// O2OA 适配器使用示例
// 演示如何使用 O2OA 适配器进行各种操作

import { createO2OAAdapter } from './o2oa-adapter.example';

async function main() {
  console.log('🚀 O2OA 适配器使用示例\n');

  // ============================================================
  // 1. 创建适配器实例
  // ============================================================
  console.log('1️⃣  创建适配器实例');
  console.log('-----------------------------------');

  const adapter = createO2OAAdapter({
    baseUrl: 'http://localhost',
    // 方式 A: 使用用户名密码（需要先登录）
    // credential: 'xadmin',
    // password: 'your_password',

    // 方式 B: 直接使用 token（推荐）
    token: 'your_token_here', // 从浏览器获取
  });

  console.log('✅ 适配器创建成功\n');

  // ============================================================
  // 2. 健康检查
  // ============================================================
  console.log('2️⃣  健康检查');
  console.log('-----------------------------------');

  try {
    const health = await adapter.healthCheck();
    console.log('健康状态:', health.healthy ? '✅ 正常' : '❌ 异常');
    console.log('响应时间:', health.latencyMs, 'ms');
    console.log('消息:', health.message);
    console.log('');
  } catch (error) {
    console.error('❌ 健康检查失败:', error);
  }

  // ============================================================
  // 3. 发现 OA 系统流程
  // ============================================================
  console.log('3️⃣  发现 OA 系统流程');
  console.log('-----------------------------------');

  try {
    const discovery = await adapter.discover();
    console.log('OA 厂商:', discovery.oaVendor);
    console.log('OA 版本:', discovery.oaVersion);
    console.log('OA 类型:', discovery.oaType);
    console.log('认证类型:', discovery.authType);
    console.log('发现的流程数量:', discovery.discoveredFlows.length);
    console.log('');

    console.log('流程列表:');
    discovery.discoveredFlows.forEach((flow, index) => {
      console.log(`  ${index + 1}. ${flow.flowName} (${flow.flowCode})`);
    });
    console.log('');
  } catch (error) {
    console.error('❌ 发现流程失败:', error);
  }

  // ============================================================
  // 4. 获取我的待办任务
  // ============================================================
  console.log('4️⃣  获取我的待办任务');
  console.log('-----------------------------------');

  try {
    const tasks = await adapter.getMyTasks(10);
    console.log('待办任务数量:', tasks.length);
    console.log('');

    if (tasks.length > 0) {
      console.log('任务列表:');
      tasks.forEach((task, index) => {
        console.log(`  ${index + 1}. ${task.title || '无标题'}`);
        console.log(`     任务 ID: ${task.id}`);
        console.log(`     工作 ID: ${task.work}`);
        console.log(`     活动名称: ${task.activityName}`);
        console.log('');
      });
    } else {
      console.log('暂无待办任务');
      console.log('');
    }
  } catch (error) {
    console.error('❌ 获取任务失败:', error);
  }

  // ============================================================
  // 5. 提交新申请（示例：差旅费报销）
  // ============================================================
  console.log('5️⃣  提交新申请（差旅费报销）');
  console.log('-----------------------------------');

  try {
    const submitResult = await adapter.submit({
      flowCode: 'travel_expense', // 流程代码（需要替换为实际的流程代码）
      formData: {
        title: '北京出差报销',
        amount: 1000,
        startDate: '2024-03-01',
        endDate: '2024-03-03',
        destination: '北京',
        purpose: '客户拜访',
        details: [
          { item: '交通费', amount: 500 },
          { item: '住宿费', amount: 300 },
          { item: '餐费', amount: 200 },
        ],
      },
      idempotencyKey: `expense-${Date.now()}`,
    });

    if (submitResult.success) {
      console.log('✅ 申请提交成功');
      console.log('申请 ID:', submitResult.submissionId);
      console.log('元数据:', submitResult.metadata);
      console.log('');

      // 保存申请 ID 用于后续查询
      const submissionId = submitResult.submissionId!;

      // ============================================================
      // 6. 查询申请状态
      // ============================================================
      console.log('6️⃣  查询申请状态');
      console.log('-----------------------------------');

      const status = await adapter.queryStatus(submissionId);
      console.log('当前状态:', status.status);
      console.log('状态详情:', status.statusDetail);
      console.log('');

      if (status.timeline && status.timeline.length > 0) {
        console.log('审批时间线:');
        status.timeline.forEach((item, index) => {
          console.log(`  ${index + 1}. ${item.timestamp}`);
          console.log(`     状态: ${item.status}`);
          console.log(`     操作人: ${item.operator || '系统'}`);
          console.log(`     意见: ${item.comment || '无'}`);
          console.log('');
        });
      }

      // ============================================================
      // 7. 催办（可选）
      // ============================================================
      console.log('7️⃣  催办申请');
      console.log('-----------------------------------');

      const urgeResult = await adapter.urge(submissionId);
      if (urgeResult.success) {
        console.log('✅ 催办成功');
        console.log('消息:', urgeResult.message);
      } else {
        console.log('❌ 催办失败');
        console.log('消息:', urgeResult.message);
      }
      console.log('');

      // ============================================================
      // 8. 取消申请（可选）
      // ============================================================
      console.log('8️⃣  取消申请（演示，不实际执行）');
      console.log('-----------------------------------');
      console.log('如需取消申请，可以调用:');
      console.log(`  await adapter.cancel('${submissionId}');`);
      console.log('');

      // 实际取消代码（注释掉）
      // const cancelResult = await adapter.cancel(submissionId);
      // if (cancelResult.success) {
      //   console.log('✅ 取消成功');
      // } else {
      //   console.log('❌ 取消失败:', cancelResult.message);
      // }
    } else {
      console.log('❌ 申请提交失败');
      console.log('错误信息:', submitResult.errorMessage);
      console.log('');
    }
  } catch (error) {
    console.error('❌ 提交申请失败:', error);
  }

  // ============================================================
  // 9. 处理任务（审批）
  // ============================================================
  console.log('9️⃣  处理任务（审批）');
  console.log('-----------------------------------');

  try {
    const tasks = await adapter.getMyTasks(1);

    if (tasks.length > 0) {
      const task = tasks[0];
      console.log('处理任务:', task.title);
      console.log('任务 ID:', task.id);
      console.log('');

      // 审批通过
      const processed = await adapter.processTask(
        task.id,
        'approve', // 路由名称（需要根据实际流程配置）
        '同意', // 审批意见
        {} // 额外数据
      );

      if (processed) {
        console.log('✅ 任务处理成功');
      } else {
        console.log('❌ 任务处理失败');
      }
      console.log('');
    } else {
      console.log('暂无待办任务需要处理');
      console.log('');
    }
  } catch (error) {
    console.error('❌ 处理任务失败:', error);
  }

  // ============================================================
  // 10. 获取流程表单定义
  // ============================================================
  console.log('🔟 获取流程表单定义');
  console.log('-----------------------------------');

  try {
    const processForm = await adapter.getProcessForm('travel_expense');
    console.log('流程名称:', processForm.name);
    console.log('流程 ID:', processForm.id);
    console.log('流程描述:', processForm.description || '无');
    console.log('');
  } catch (error) {
    console.error('❌ 获取流程表单失败:', error);
  }

  console.log('✅ 示例执行完成！');
}

// ============================================================
// 错误处理示例
// ============================================================
async function errorHandlingExample() {
  console.log('\n📚 错误处理示例\n');

  const adapter = createO2OAAdapter({
    baseUrl: 'http://localhost',
    token: 'invalid_token',
  });

  try {
    await adapter.discover();
  } catch (error: any) {
    console.log('捕获到错误:');
    console.log('  类型:', error.constructor.name);
    console.log('  消息:', error.message);
    console.log('  建议: 检查 token 是否有效，或重新登录获取新 token');
  }
}

// ============================================================
// 批量操作示例
// ============================================================
async function batchOperationsExample() {
  console.log('\n📦 批量操作示例\n');

  const adapter = createO2OAAdapter({
    baseUrl: 'http://localhost',
    token: 'your_token_here',
  });

  // 批量提交多个申请
  const applications = [
    {
      flowCode: 'leave_request',
      formData: {
        title: '年假申请',
        leaveType: 'annual',
        startDate: '2024-03-10',
        endDate: '2024-03-12',
        reason: '家里有事',
      },
    },
    {
      flowCode: 'travel_expense',
      formData: {
        title: '上海出差报销',
        amount: 1500,
        startDate: '2024-03-05',
        endDate: '2024-03-07',
        destination: '上海',
      },
    },
  ];

  console.log('批量提交申请...');

  const results = await Promise.allSettled(
    applications.map((app) =>
      adapter.submit({
        ...app,
        idempotencyKey: `batch-${Date.now()}-${Math.random()}`,
      })
    )
  );

  results.forEach((result, index) => {
    if (result.status === 'fulfilled' && result.value.success) {
      console.log(`✅ 申请 ${index + 1} 提交成功:`, result.value.submissionId);
    } else {
      console.log(`❌ 申请 ${index + 1} 提交失败`);
    }
  });
}

// ============================================================
// 运行示例
// ============================================================
if (require.main === module) {
  main()
    .then(() => {
      console.log('\n✅ 所有示例执行完成');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n❌ 执行失败:', error);
      process.exit(1);
    });
}

// 导出函数供其他模块使用
export { main, errorHandlingExample, batchOperationsExample };
