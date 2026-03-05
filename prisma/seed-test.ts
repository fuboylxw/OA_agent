import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 开始数据库种子数据...');

  // 1. 创建测试租户
  const tenant = await prisma.tenant.upsert({
    where: { code: 'test-tenant' },
    create: {
      code: 'test-tenant',
      name: '测试租户',
      status: 'active',
    },
    update: {
      name: '测试租户',
      status: 'active',
    },
  });

  console.log('✓ 创建租户:', tenant.name);

  // 2. 创建测试用户
  const user = await prisma.user.upsert({
    where: {
      tenantId_username: {
        tenantId: tenant.id,
        username: 'testuser',
      },
    },
    create: {
      tenantId: tenant.id,
      username: 'testuser',
      email: 'test@example.com',
      displayName: '测试用户',
      roles: ['user'],
      status: 'active',
    },
    update: {
      displayName: '测试用户',
      status: 'active',
    },
  });

  console.log('✓ 创建用户:', user.displayName);

  // 3. 创建测试连接器
  const connector = await prisma.connector.upsert({
    where: {
      tenantId_name: {
        tenantId: tenant.id,
        name: 'test-connector',
      },
    },
    create: {
      tenantId: tenant.id,
      name: 'test-connector',
      oaType: 'openapi',
      oaVendor: 'Test OA',
      oaVersion: '1.0.0',
      baseUrl: 'https://test-oa.example.com/api',
      authType: 'apikey',
      authConfig: {
        type: 'apikey',
        headerName: 'X-API-Key',
        token: 'test-api-key-123',
      },
      healthCheckUrl: 'https://test-oa.example.com/health',
      oclLevel: 'OCL3',
      falLevel: 'F2',
      status: 'active',
    },
    update: {
      status: 'active',
      baseUrl: 'https://test-oa.example.com/api',
    },
  });

  console.log('✓ 创建连接器:', connector.name);

  // 4. 创建示例流程模板
  const leaveTemplate = await prisma.processTemplate.upsert({
    where: {
      tenantId_processCode_version: {
        tenantId: tenant.id,
        processCode: 'leave_request',
        version: 1,
      },
    },
    create: {
      tenantId: tenant.id,
      connectorId: connector.id,
      processCode: 'leave_request',
      processName: '请假申请',
      processCategory: '请假',
      version: 1,
      status: 'published',
      falLevel: 'F2',
      schema: {
        fields: [
          {
            key: 'startDate',
            label: '开始日期',
            type: 'date',
            required: true,
          },
          {
            key: 'endDate',
            label: '结束日期',
            type: 'date',
            required: true,
          },
          {
            key: 'reason',
            label: '请假原因',
            type: 'text',
            required: true,
          },
          {
            key: 'leaveType',
            label: '请假类型',
            type: 'select',
            required: true,
            options: ['年假', '病假', '事假'],
          },
        ],
      },
      rules: {
        validation: [
          {
            field: 'startDate',
            rule: 'required',
            message: '开始日期不能为空',
          },
        ],
      },
      publishedAt: new Date(),
    },
    update: {
      status: 'published',
    },
  });

  console.log('✓ 创建流程模板:', leaveTemplate.processName);

  // 5. 创建示例MCP工具
  const mcpTool = await prisma.mCPTool.upsert({
    where: {
      connectorId_toolName: {
        connectorId: connector.id,
        toolName: 'leave_request_submit',
      },
    },
    create: {
      tenantId: tenant.id,
      connectorId: connector.id,
      toolName: 'leave_request_submit',
      toolDescription: '提交请假申请',
      toolSchema: {
        type: 'object',
        properties: {
          startDate: { type: 'string', format: 'date' },
          endDate: { type: 'string', format: 'date' },
          reason: { type: 'string' },
          leaveType: { type: 'string' },
        },
        required: ['startDate', 'endDate', 'reason'],
      },
      apiEndpoint: '/leave/submit',
      httpMethod: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      bodyTemplate: {
        startDate: '{{startDate}}',
        endDate: '{{endDate}}',
        reason: '{{reason}}',
        leaveType: '{{leaveType}}',
      },
      paramMapping: {
        startDate: 'startDate',
        endDate: 'endDate',
        reason: 'reason',
        leaveType: 'leaveType',
      },
      responseMapping: {
        success: 'success',
        data: 'data',
        message: 'message',
      },
      flowCode: 'leave_request',
      category: 'submit',
      enabled: true,
      testInput: {
        startDate: '2024-03-20',
        endDate: '2024-03-22',
        reason: '家庭事务',
        leaveType: '事假',
      },
    },
    update: {
      enabled: true,
    },
  });

  console.log('✓ 创建MCP工具:', mcpTool.toolName);

  console.log('\n✅ 数据库种子数据完成！');
  console.log('\n测试数据:');
  console.log(`  租户ID: ${tenant.id}`);
  console.log(`  用户ID: ${user.id}`);
  console.log(`  连接器ID: ${connector.id}`);
  console.log(`  流程模板ID: ${leaveTemplate.id}`);
  console.log(`  MCP工具ID: ${mcpTool.id}`);
}

main()
  .catch((e) => {
    console.error('❌ 种子数据失败:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });