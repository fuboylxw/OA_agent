import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';

const API_BASE_URL = 'http://localhost:3001/api/v1';
const TEST_TENANT_ID = 'test-tenant';
const TEST_CONNECTOR_ID = 'test-connector';

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
      timeout: 10000,
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

  // 创建测试租户（通过数据库或API）
  // 这里我们假设租户已存在，或者通过seed脚本创建

  console.log(`✓ 测试租户ID: ${TEST_TENANT_ID}`);
  console.log(`✓ 测试连接器ID: ${TEST_CONNECTOR_ID}`);
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
      tenantId: TEST_TENANT_ID,
      connectorId: TEST_CONNECTOR_ID,
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
      tenantId: TEST_TENANT_ID,
      connectorId: TEST_CONNECTOR_ID,
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
    { connectorId: TEST_CONNECTOR_ID },
  );

  testResults.push(listResult);

  // 按分类查询
  const categoryResult = await testEndpoint(
    '按分类查询MCP工具',
    'GET',
    '/mcp/tools',
    null,
    { connectorId: TEST_CONNECTOR_ID, category: 'submit' },
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
    { connectorId: TEST_CONNECTOR_ID },
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
    { tenantId: TEST_TENANT_ID },
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
    { tenantId: TEST_TENANT_ID },
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
    const uploadResult = await testApiUpload();

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

    process.exit(allPassed ? 0 : 1);
  } catch (error: any) {
    console.error('\n❌ 测试过程中发生错误:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

// 运行测试
runAllTests().catch(console.error);