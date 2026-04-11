import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';
import { readEnv, resolveApiOrigin } from './lib/api-config';

const API_BASE_URL = resolveApiOrigin();
const TEST_TENANT_ID = readEnv('TEST_TENANT_ID', 'TEST_TENANT_CODE') || 'test-tenant';
const TEST_CONNECTOR_ID = readEnv('TEST_CONNECTOR_ID', 'TEST_CONNECTOR_NAME') || 'test-connector';

/**
 * 测试API上传和办事流程识别系统
 */
async function testApiUploadSystem() {
  console.log('='.repeat(60));
  console.log('API上传与办事流程识别系统测试');
  console.log('='.repeat(60));

  // 示例OpenAPI文档
  const sampleOpenApiDoc = {
    openapi: '3.0.0',
    info: {
      title: 'OA System API',
      version: '1.0.0',
    },
    servers: [
      {
        url: 'https://oa.example.com/api',
      },
    ],
    paths: {
      '/leave/submit': {
        post: {
          summary: '提交请假申请',
          description: '员工提交请假申请',
          parameters: [],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['startDate', 'endDate', 'reason', 'leaveType'],
                  properties: {
                    startDate: {
                      type: 'string',
                      format: 'date',
                      description: '开始日期',
                    },
                    endDate: {
                      type: 'string',
                      format: 'date',
                      description: '结束日期',
                    },
                    reason: {
                      type: 'string',
                      description: '请假原因',
                    },
                    leaveType: {
                      type: 'string',
                      enum: ['annual', 'sick', 'personal'],
                      description: '请假类型',
                    },
                  },
                },
              },
            },
          },
          responses: {
            '200': {
              description: 'Success',
            },
          },
        },
      },
      '/expense/submit': {
        post: {
          summary: '提交报销申请',
          description: '员工提交费用报销申请',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['amount', 'category', 'description'],
                  properties: {
                    amount: {
                      type: 'number',
                      description: '报销金额',
                    },
                    category: {
                      type: 'string',
                      description: '报销类别',
                    },
                    description: {
                      type: 'string',
                      description: '报销说明',
                    },
                    attachments: {
                      type: 'array',
                      items: {
                        type: 'string',
                      },
                      description: '附件列表',
                    },
                  },
                },
              },
            },
          },
          responses: {
            '200': {
              description: 'Success',
            },
          },
        },
      },
      '/attendance/query': {
        get: {
          summary: '查询考勤记录',
          description: '查询员工考勤记录',
          parameters: [
            {
              name: 'startDate',
              in: 'query',
              required: true,
              schema: {
                type: 'string',
                format: 'date',
              },
              description: '开始日期',
            },
            {
              name: 'endDate',
              in: 'query',
              required: true,
              schema: {
                type: 'string',
                format: 'date',
              },
              description: '结束日期',
            },
          ],
          responses: {
            '200': {
              description: 'Success',
            },
          },
        },
      },
      '/user/profile': {
        get: {
          summary: '获取用户信息',
          description: '获取当前用户的个人信息',
          responses: {
            '200': {
              description: 'Success',
            },
          },
        },
      },
      '/system/config': {
        get: {
          summary: '获取系统配置',
          description: '获取系统配置信息',
          responses: {
            '200': {
              description: 'Success',
            },
          },
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

  try {
    // 步骤1: 上传API文档
    console.log('\n步骤1: 上传API文档');
    console.log('-'.repeat(60));

    const uploadResponse = await axios.post(
      `${API_BASE_URL}/mcp/upload-api-json`,
      {
        tenantId: TEST_TENANT_ID,
        connectorId: TEST_CONNECTOR_ID,
        docType: 'openapi',
        docContent: JSON.stringify(sampleOpenApiDoc),
        oaUrl: 'https://oa.example.com',
        authConfig: {
          type: 'apikey',
          headerName: 'X-API-Key',
          apiKey: 'test-api-key',
        },
        autoValidate: false, // 跳过验证以便测试
        autoGenerateMcp: true,
      },
    );

    const result = uploadResponse.data;

    console.log(`✓ 上传成功`);
    console.log(`  - 总接口数: ${result.totalEndpoints}`);
    console.log(`  - 办事流程接口: ${result.workflowEndpoints}`);
    console.log(`  - 生成MCP工具: ${result.generatedMcpTools}`);

    // 步骤2: 显示识别的办事流程接口
    console.log('\n步骤2: 识别的办事流程接口');
    console.log('-'.repeat(60));

    result.workflowApis.forEach((api: any, index: number) => {
      console.log(`\n${index + 1}. ${api.processName}`);
      console.log(`   路径: ${api.method} ${api.path}`);
      console.log(`   分类: ${api.workflowCategory}`);
      console.log(`   类型: ${api.workflowType}`);
      console.log(`   置信度: ${(api.confidence * 100).toFixed(0)}%`);
      console.log(`   原因: ${api.reason}`);
    });

    // 步骤3: 显示生成的MCP工具
    console.log('\n步骤3: 生成的MCP工具');
    console.log('-'.repeat(60));

    result.mcpTools.forEach((tool: any, index: number) => {
      console.log(`\n${index + 1}. ${tool.toolName}`);
      console.log(`   描述: ${tool.toolDescription}`);
      console.log(`   分类: ${tool.category}`);
      console.log(`   端点: ${tool.httpMethod} ${tool.apiEndpoint}`);
      console.log(`   流程代码: ${tool.flowCode}`);
    });

    // 步骤4: 查询流程库
    console.log('\n步骤4: 查询流程库');
    console.log('-'.repeat(60));

    const historyResponse = await axios.get(
      `${API_BASE_URL}/mcp/upload-history`,
      {
        params: {
          tenantId: TEST_TENANT_ID,
          connectorId: TEST_CONNECTOR_ID,
        },
      },
    );

    const processes = historyResponse.data;
    console.log(`✓ 找到 ${processes.length} 个流程`);

    processes.forEach((process: any, index: number) => {
      console.log(`\n${index + 1}. ${process.processName}`);
      console.log(`   代码: ${process.processCode}`);
      console.log(`   分类: ${process.processCategory}`);
      console.log(`   状态: ${process.status}`);
      console.log(`   自动化级别: ${process.falLevel}`);
    });

    // 步骤5: 测试MCP工具
    console.log('\n步骤5: 测试MCP工具');
    console.log('-'.repeat(60));

    if (result.mcpTools.length > 0) {
      const firstTool = result.mcpTools[0];
      console.log(`\n测试工具: ${firstTool.toolName}`);

      try {
        const testResponse = await axios.post(
          `${API_BASE_URL}/mcp/tools/${firstTool.toolName}/test`,
          {},
          {
            params: {
              connectorId: TEST_CONNECTOR_ID,
            },
          },
        );

        console.log(`✓ 测试执行成功`);
        console.log(`  结果:`, JSON.stringify(testResponse.data, null, 2));
      } catch (error: any) {
        console.log(`✗ 测试执行失败: ${error.message}`);
        console.log(`  (这是预期的，因为我们使用的是示例URL)`);
      }
    }

    console.log('\n' + '='.repeat(60));
    console.log('测试完成！');
    console.log('='.repeat(60));

    // 生成测试报告
    const report = {
      timestamp: new Date().toISOString(),
      summary: {
        totalEndpoints: result.totalEndpoints,
        workflowEndpoints: result.workflowEndpoints,
        validatedEndpoints: result.validatedEndpoints,
        generatedMcpTools: result.generatedMcpTools,
      },
      workflowApis: result.workflowApis,
      mcpTools: result.mcpTools.map((t: any) => ({
        toolName: t.toolName,
        category: t.category,
        flowCode: t.flowCode,
      })),
    };

    const reportPath = path.join(__dirname, '../test-reports/api-upload-test-report.json');
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));

    console.log(`\n测试报告已保存到: ${reportPath}`);

  } catch (error: any) {
    console.error('\n测试失败:', error.message);
    if (error.response) {
      console.error('响应数据:', error.response.data);
    }
    process.exit(1);
  }
}

// 运行测试
testApiUploadSystem().catch(console.error);
