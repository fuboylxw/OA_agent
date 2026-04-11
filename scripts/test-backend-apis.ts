import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';
import { PrismaClient } from '@prisma/client';
import { readEnv, resolveApiBaseUrl } from './lib/api-config';

const API_BASE_URL = resolveApiBaseUrl();
const TEST_TENANT_CODE = readEnv('TEST_TENANT_CODE') || 'test-tenant';
const TEST_CONNECTOR_NAME = readEnv('TEST_CONNECTOR_NAME') || 'test-connector';

const prisma = new PrismaClient();
let testTenantId = '';
let testConnectorId = '';

interface TestResult {
  endpoint: string;
  method: string;
  status: 'success' | 'failed';
  statusCode?: number;
  responseTime?: number;
  error?: string;
  data?: any;
}

const testResults: TestResult[] = [];

/**
 * 测试辅助函数
 */
async function testEndpoint(
  name: string,
  method: string,
  url: string,
  data?: any,
  params?: any,
  timeout = 10000,
): Promise<TestResult> {
  const startTime = Date.now();
  const result: TestResult = {
    endpoint: name,
    method,
    status: 'failed',
  };

  try {
    console.log(`\n🧪 测试: ${name}`);
    console.log(`   ${method} ${url}`);

    const config: any = {
      method,
      url: `${API_BASE_URL}${url}`,
      timeout,
    };

    if (data) {
      config.data = data;
    }

    if (params) {
      config.params = params;
    }

    const response = await axios(config);
    const responseTime = Date.now() - startTime;

    result.status = 'success';
    result.statusCode = response.status;
    result.responseTime = responseTime;
    result.data = response.data;

    console.log(`   ✅ 成功 (${response.status}) - ${responseTime}ms`);
    if (response.data) {
      console.log(`   📦 数据:`, JSON.stringify(response.data, null, 2).substring(0, 200));
    }

    return result;
  } catch (error: any) {
    const responseTime = Date.now() - startTime;
    result.responseTime = responseTime;
    result.statusCode = error.response?.status;
    result.error = error.message;

    console.log(`   ❌ 失败 (${error.response?.status || 'N/A'}) - ${responseTime}ms`);
    console.log(`   错误: ${error.message}`);

    return result;
  }
}

/**
 * 准备测试数据
 */
async function setupTestData() {
  console.log('\n📋 准备测试数据...');
  console.log('='.repeat(60));

  const tenant = await prisma.tenant.findUnique({
    where: { code: TEST_TENANT_CODE },
    select: { id: true, code: true },
  });

  if (!tenant) {
    throw new Error(`未找到测试租户 ${TEST_TENANT_CODE}，请先执行 prisma/seed-test.ts`);
  }

  const connector = await prisma.connector.findFirst({
    where: {
      tenantId: tenant.id,
      name: TEST_CONNECTOR_NAME,
    },
    select: { id: true, name: true },
  });

  if (!connector) {
    throw new Error(`未找到测试连接器 ${TEST_CONNECTOR_NAME}，请先执行 prisma/seed-test.ts`);
  }

  testTenantId = tenant.id;
  testConnectorId = connector.id;

  console.log(`✓ 测试租户ID: ${testTenantId}`);
  console.log(`✓ 测试连接器ID: ${testConnectorId}`);
}

/**
 * 测试健康检查
 */
async function testHealthCheck() {
  console.log('\n\n📍 1. 健康检查');
  console.log('='.repeat(60));

  const result = await testEndpoint(
    '健康检查',
    'GET',
    '/health',
  );

  testResults.push(result);
}

/**
 * 测试API上传功能
 */
async function testApiUpload() {
  console.log('\n\n📍 2. API上传功能');
  console.log('='.repeat(60));

  const sampleApiDoc = {
    openapi: '3.0.0',
    info: {
      title: 'Test OA API',
      version: '1.0.0',
    },
    servers: [{ url: 'https://test-oa.example.com/api' }],
    paths: {
      '/leave/submit': {
        post: {
          summary: '提交请假申请',
          description: '员工提交请假申请',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['startDate', 'endDate', 'reason'],
                  properties: {
                    startDate: { type: 'string', format: 'date' },
                    endDate: { type: 'string', format: 'date' },
                    reason: { type: 'string' },
                    leaveType: { type: 'string' },
                  },
                },
              },
            },
          },
          responses: { '200': { description: 'Success' } },
        },
      },
      '/expense/submit': {
        post: {
          summary: '提交报销申请',
          description: '员工提交报销申请',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['amount', 'category'],
                  properties: {
                    amount: { type: 'number' },
                    category: { type: 'string' },
                    description: { type: 'string' },
                  },
                },
              },
            },
          },
          responses: { '200': { description: 'Success' } },
        },
      },
      '/user/profile': {
        get: {
          summary: '获取用户信息',
          responses: { '200': { description: 'Success' } },
        },
      },
    },
    components: {
      securitySchemes: {
        ApiKeyAuth: {
          type: 'apiKey',
          in: 'header',
          name: 'X-API-Key',
        },
      },
    },
  };

  const result = await testEndpoint(
    'API上传 (JSON)',
    'POST',
    '/mcp/upload-api-json',
    {
      tenantId: testTenantId,
      connectorId: testConnectorId,
      docType: 'openapi',
      docContent: JSON.stringify(sampleApiDoc),
      oaUrl: 'https://test-oa.example.com',
      authConfig: {
        type: 'apikey',
        headerName: 'X-API-Key',
        apiKey: 'test-key-123',
      },
      autoValidate: false,
      autoGenerateMcp: true,
    },
    null,
    30000,
  );

  testResults.push(result);

  return result.data;
}

/**
 * 测试上传历史查询
 */
async function testUploadHistory() {
  console.log('\n\n📍 3. 上传历史查询');
  console.log('='.repeat(60));

  const result = await testEndpoint(
    '获取上传历史',
    'GET',
    '/mcp/upload-history',
    null,
    {
      tenantId: testTenantId,
      connectorId: testConnectorId,
    },
  );

  testResults.push(result);
  return result.data;
}

/**
 * 测试MCP工具列表
 */
async function testMcpToolsList() {
  console.log('\n\n📍 4. MCP工具管理');
  console.log('='.repeat(60));

  // 列出所有工具
  const listResult = await testEndpoint(
    '列出MCP工具',
    'GET',
    '/mcp/tools',
    null,
    { connectorId: testConnectorId },
  );

  testResults.push(listResult);

  // 按分类查询
  const categoryResult = await testEndpoint(
    '按分类查询MCP工具',
    'GET',
    '/mcp/tools',
    null,
    { connectorId: testConnectorId, category: 'submit' },
  );

  testResults.push(categoryResult);

  return listResult.data;
}

/**
 * 测试MCP工具详情
 */
async function testMcpToolDetail(toolName: string) {
  console.log('\n\n📍 5. MCP工具详情');
  console.log('='.repeat(60));

  const result = await testEndpoint(
    '获取MCP工具详情',
    'GET',
    `/mcp/tools/${toolName}`,
    null,
    { connectorId: testConnectorId },
  );

  testResults.push(result);
  return result.data;
}

/**
 * 测试流程库
 */
async function testProcessLibrary() {
  console.log('\n\n📍 6. 流程库查询');
  console.log('='.repeat(60));

  const result = await testEndpoint(
    '查询流程库',
    'GET',
    '/process-library',
    null,
    { tenantId: testTenantId },
  );

  testResults.push(result);
  return result.data;
}

/**
 * 测试连接器管理
 */
async function testConnectorManagement() {
  console.log('\n\n📍 7. 连接器管理');
  console.log('='.repeat(60));

  // 列出连接器
  const listResult = await testEndpoint(
    '列出连接器',
    'GET',
    '/connectors',
    null,
    { tenantId: testTenantId },
  );

  testResults.push(listResult);
  return listResult.data;
}

/**
 * 生成测试报告
 */
function generateReport() {
  console.log('\n\n📊 测试报告');
  console.log('='.repeat(60));

  const total = testResults.length;
  const success = testResults.filter(r => r.status === 'success').length;
  const failed = testResults.filter(r => r.status === 'failed').length;
  const successRate = ((success / total) * 100).toFixed(2);

  console.log(`\n总测试数: ${total}`);
  console.log(`✅ 成功: ${success}`);
  console.log(`❌ 失败: ${failed}`);
  console.log(`📈 成功率: ${successRate}%`);

  console.log('\n详细结果:');
  console.log('-'.repeat(60));

  testResults.forEach((result, index) => {
    const icon = result.status === 'success' ? '✅' : '❌';
    const time = result.responseTime ? `${result.responseTime}ms` : 'N/A';
    const status = result.statusCode || 'N/A';

    console.log(`${index + 1}. ${icon} ${result.endpoint}`);
    console.log(`   ${result.method} - 状态: ${status} - 耗时: ${time}`);
    if (result.error) {
      console.log(`   错误: ${result.error}`);
    }
  });

  // 保存报告
  const report = {
    timestamp: new Date().toISOString(),
    summary: {
      total,
      success,
      failed,
      successRate: parseFloat(successRate),
    },
    results: testResults,
  };

  const reportPath = path.join(__dirname, '../test-reports/backend-api-test-report.json');
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));

  console.log(`\n📄 测试报告已保存: ${reportPath}`);

  return successRate === '100.00';
}

/**
 * 主测试流程
 */
async function runAllTests() {
  console.log('🚀 开始后端API完整测试');
  console.log('='.repeat(60));
  console.log(`测试目标: ${API_BASE_URL}`);
  console.log(`开始时间: ${new Date().toLocaleString('zh-CN')}`);

  try {
    // 准备测试数据
    await setupTestData();

    // 1. 健康检查
    await testHealthCheck();

    // 2. API上传
    await testApiUpload();

    // 3. 上传历史
    await testUploadHistory();

    // 4. MCP工具列表
    const tools = await testMcpToolsList();

    // 5. MCP工具详情（如果有工具）
    if (tools && tools.length > 0) {
      await testMcpToolDetail(tools[0].toolName);
    }

    // 6. 流程库
    await testProcessLibrary();

    // 7. 连接器管理
    await testConnectorManagement();

    // 生成报告
    const allPassed = generateReport();

    console.log('\n' + '='.repeat(60));
    if (allPassed) {
      console.log('🎉 所有测试通过！');
    } else {
      console.log('⚠️  部分测试失败，请查看详细报告');
    }
    console.log('='.repeat(60));

    return allPassed;
  } catch (error: any) {
    console.error('\n❌ 测试过程中发生错误:', error.message);
    console.error(error.stack);
    return false;
  } finally {
    await prisma.$disconnect();
  }
}

// 运行测试
runAllTests()
  .then((allPassed) => {
    process.exitCode = allPassed ? 0 : 1;
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
