#!/usr/bin/env ts-node
/**
 * 全面API测试脚本
 * 测试所有模块的接口功能，确保系统运行通畅
 */

import axios, { AxiosInstance } from 'axios';

const API_BASE_URL = process.env.API_URL || 'http://localhost:3001';
const API_PREFIX = '/api/v1';

interface TestResult {
  module: string;
  endpoint: string;
  method: string;
  status: 'PASS' | 'FAIL' | 'SKIP';
  statusCode?: number;
  error?: string;
  duration?: number;
}

class APITester {
  private client: AxiosInstance;
  private results: TestResult[] = [];
  private tenantId = 'test-tenant';
  private userId = 'test-user';

  constructor() {
    this.client = axios.create({
      baseURL: `${API_BASE_URL}${API_PREFIX}`,
      timeout: 10000,
      headers: {
        'Content-Type': 'application/json',
        'X-Tenant-ID': this.tenantId,
        'X-User-ID': this.userId,
      },
      validateStatus: () => true, // 不抛出错误，手动处理
    });
  }

  private async test(
    module: string,
    endpoint: string,
    method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH',
    data?: any,
    expectedStatus: number[] = [200, 201]
  ): Promise<TestResult> {
    const startTime = Date.now();
    const result: TestResult = {
      module,
      endpoint,
      method,
      status: 'FAIL',
    };

    try {
      const response = await this.client.request({
        method,
        url: endpoint,
        data,
      });

      result.statusCode = response.status;
      result.duration = Date.now() - startTime;

      if (expectedStatus.includes(response.status)) {
        result.status = 'PASS';
      } else {
        result.error = `Expected status ${expectedStatus.join(' or ')}, got ${response.status}`;
      }

      return response.data;
    } catch (error: any) {
      result.error = error.message;
      result.duration = Date.now() - startTime;
    } finally {
      this.results.push(result);
    }

    return result;
  }

  // 1. Health Check
  async testHealthCheck() {
    console.log('\n=== Testing Health Check ===');
    await this.test('Common', '/health', 'GET', undefined, [200]);
  }

  // 2. Bootstrap Module
  async testBootstrap() {
    console.log('\n=== Testing Bootstrap Module ===');

    // Create bootstrap job
    const createData = {
      name: 'Test OA System',
      description: 'Test bootstrap job',
      sourceType: 'openapi',
      sourceData: {
        url: 'http://example.com/openapi.json',
      },
    };
    const job = await this.test('Bootstrap', '/bootstrap/jobs', 'POST', createData, [201]);

    if (job && job.id) {
      // Get job by ID
      await this.test('Bootstrap', `/bootstrap/jobs/${job.id}`, 'GET');

      // List jobs
      await this.test('Bootstrap', '/bootstrap/jobs', 'GET');

      // Get report
      await this.test('Bootstrap', `/bootstrap/jobs/${job.id}/report`, 'GET', undefined, [200, 404]);

      // Trigger discovery
      await this.test('Bootstrap', `/bootstrap/jobs/${job.id}/discover`, 'POST', undefined, [200, 400]);

      // Get OCL report
      await this.test('Bootstrap', `/bootstrap/jobs/${job.id}/ocl`, 'GET', undefined, [200, 404]);

      // Publish (will fail if not in REVIEW state)
      await this.test('Bootstrap', `/bootstrap/jobs/${job.id}/publish`, 'POST', undefined, [200, 400]);
    }
  }

  // 3. Connector Module
  async testConnector() {
    console.log('\n=== Testing Connector Module ===');

    // Create connector
    const createData = {
      name: 'Test Connector',
      type: 'openapi',
      config: {
        baseUrl: 'http://example.com',
        apiKey: 'test-key',
      },
      oaVendor: 'TestOA',
      oaVersion: '1.0',
    };
    const connector = await this.test('Connector', '/connectors', 'POST', createData, [201]);

    if (connector && connector.id) {
      // Get connector by ID
      await this.test('Connector', `/connectors/${connector.id}`, 'GET');

      // List connectors
      await this.test('Connector', '/connectors', 'GET');

      // Update connector
      await this.test('Connector', `/connectors/${connector.id}`, 'PUT', {
        name: 'Updated Connector',
      });

      // Test connection
      await this.test('Connector', `/connectors/${connector.id}/test`, 'POST', undefined, [200, 400]);

      // Delete connector
      await this.test('Connector', `/connectors/${connector.id}`, 'DELETE', undefined, [200, 204]);
    }
  }

  // 4. Process Library Module
  async testProcessLibrary() {
    console.log('\n=== Testing Process Library Module ===');

    // List processes
    await this.test('ProcessLibrary', '/processes', 'GET');

    // Search processes
    await this.test('ProcessLibrary', '/processes/search?q=报销', 'GET', undefined, [200, 404]);

    // Get process by code
    await this.test('ProcessLibrary', '/processes/EXPENSE_CLAIM', 'GET', undefined, [200, 404]);

    // Get process fields
    await this.test('ProcessLibrary', '/processes/EXPENSE_CLAIM/fields', 'GET', undefined, [200, 404]);
  }

  // 5. Permission Module
  async testPermission() {
    console.log('\n=== Testing Permission Module ===');

    // Check permission
    const checkData = {
      userId: this.userId,
      processCode: 'EXPENSE_CLAIM',
      action: 'submit',
    };
    await this.test('Permission', '/permissions/check', 'POST', checkData, [200, 403]);

    // List user permissions
    await this.test('Permission', `/permissions/users/${this.userId}`, 'GET', undefined, [200, 404]);

    // List policies
    await this.test('Permission', '/permissions/policies', 'GET');
  }

  // 6. Assistant Module
  async testAssistant() {
    console.log('\n=== Testing Assistant Module ===');

    // Create chat session
    const sessionData = {
      userId: this.userId,
    };
    const session = await this.test('Assistant', '/assistant/sessions', 'POST', sessionData, [201]);

    if (session && session.id) {
      // Send message
      const messageData = {
        message: '我要报销差旅费1000元',
      };
      await this.test('Assistant', `/assistant/sessions/${session.id}/messages`, 'POST', messageData);

      // Get session
      await this.test('Assistant', `/assistant/sessions/${session.id}`, 'GET');

      // List sessions
      await this.test('Assistant', '/assistant/sessions', 'GET');

      // Get draft
      await this.test('Assistant', `/assistant/sessions/${session.id}/draft`, 'GET', undefined, [200, 404]);
    }
  }

  // 7. Rule Module
  async testRule() {
    console.log('\n=== Testing Rule Module ===');

    // Validate form data
    const validateData = {
      processCode: 'EXPENSE_CLAIM',
      formData: {
        amount: 1000,
        reason: '出差北京',
        date: '2024-03-15',
      },
    };
    await this.test('Rule', '/rules/validate', 'POST', validateData, [200, 400]);

    // List rules for process
    await this.test('Rule', '/rules?processCode=EXPENSE_CLAIM', 'GET', undefined, [200, 404]);
  }

  // 8. Submission Module
  async testSubmission() {
    console.log('\n=== Testing Submission Module ===');

    // Create submission
    const submitData = {
      processCode: 'EXPENSE_CLAIM',
      formData: {
        amount: 1000,
        reason: '出差北京',
        date: '2024-03-15',
      },
      idempotencyKey: `test-${Date.now()}`,
    };
    const submission = await this.test('Submission', '/submissions', 'POST', submitData, [201, 400]);

    if (submission && submission.id) {
      // Get submission by ID
      await this.test('Submission', `/submissions/${submission.id}`, 'GET');

      // List submissions
      await this.test('Submission', '/submissions', 'GET');

      // Get available actions
      await this.test('Submission', `/submissions/${submission.id}/actions`, 'GET');

      // Cancel submission
      await this.test('Submission', `/submissions/${submission.id}/cancel`, 'POST', undefined, [200, 400]);

      // Urge submission
      await this.test('Submission', `/submissions/${submission.id}/urge`, 'POST', undefined, [200, 400]);

      // Supplement submission
      await this.test(
        'Submission',
        `/submissions/${submission.id}/supplement`,
        'POST',
        { files: [] },
        [200, 400]
      );

      // Delegate submission
      await this.test(
        'Submission',
        `/submissions/${submission.id}/delegate`,
        'POST',
        { targetUserId: 'other-user' },
        [200, 400]
      );
    }
  }

  // 9. Status Module
  async testStatus() {
    console.log('\n=== Testing Status Module ===');

    // Query status
    await this.test('Status', '/status/query?processCode=EXPENSE_CLAIM', 'GET', undefined, [200, 404]);

    // Get my submissions
    await this.test('Status', '/status/my-submissions', 'GET');

    // Get submission timeline
    await this.test('Status', '/status/timeline/test-submission-id', 'GET', undefined, [200, 404]);
  }

  // 10. Audit Module
  async testAudit() {
    console.log('\n=== Testing Audit Module ===');

    // List audit logs
    await this.test('Audit', '/audit/logs', 'GET');

    // Search audit logs
    await this.test('Audit', '/audit/logs/search?userId=' + this.userId, 'GET');

    // Get audit log by ID
    await this.test('Audit', '/audit/logs/test-log-id', 'GET', undefined, [200, 404]);

    // Get statistics
    await this.test('Audit', '/audit/stats', 'GET');
  }

  // Run all tests
  async runAllTests() {
    console.log('🚀 Starting comprehensive API tests...');
    console.log(`API Base URL: ${API_BASE_URL}${API_PREFIX}`);
    console.log(`Tenant ID: ${this.tenantId}`);
    console.log(`User ID: ${this.userId}`);

    try {
      await this.testHealthCheck();
      await this.testBootstrap();
      await this.testConnector();
      await this.testProcessLibrary();
      await this.testPermission();
      await this.testAssistant();
      await this.testRule();
      await this.testSubmission();
      await this.testStatus();
      await this.testAudit();
    } catch (error) {
      console.error('❌ Test suite failed:', error);
    }

    this.printResults();
  }

  // Print test results
  private printResults() {
    console.log('\n' + '='.repeat(80));
    console.log('📊 TEST RESULTS SUMMARY');
    console.log('='.repeat(80));

    const groupedResults = this.results.reduce((acc, result) => {
      if (!acc[result.module]) {
        acc[result.module] = [];
      }
      acc[result.module].push(result);
      return acc;
    }, {} as Record<string, TestResult[]>);

    let totalPass = 0;
    let totalFail = 0;
    let totalSkip = 0;

    Object.entries(groupedResults).forEach(([module, results]) => {
      const pass = results.filter((r) => r.status === 'PASS').length;
      const fail = results.filter((r) => r.status === 'FAIL').length;
      const skip = results.filter((r) => r.status === 'SKIP').length;

      totalPass += pass;
      totalFail += fail;
      totalSkip += skip;

      console.log(`\n${module}:`);
      console.log(`  ✅ Pass: ${pass}`);
      console.log(`  ❌ Fail: ${fail}`);
      console.log(`  ⏭️  Skip: ${skip}`);

      if (fail > 0) {
        console.log('  Failed tests:');
        results
          .filter((r) => r.status === 'FAIL')
          .forEach((r) => {
            console.log(`    - ${r.method} ${r.endpoint}`);
            console.log(`      Status: ${r.statusCode || 'N/A'}`);
            console.log(`      Error: ${r.error || 'Unknown'}`);
            console.log(`      Duration: ${r.duration || 0}ms`);
          });
      }
    });

    console.log('\n' + '='.repeat(80));
    console.log('OVERALL RESULTS:');
    console.log(`  Total Tests: ${this.results.length}`);
    console.log(`  ✅ Passed: ${totalPass} (${((totalPass / this.results.length) * 100).toFixed(1)}%)`);
    console.log(`  ❌ Failed: ${totalFail} (${((totalFail / this.results.length) * 100).toFixed(1)}%)`);
    console.log(`  ⏭️  Skipped: ${totalSkip} (${((totalSkip / this.results.length) * 100).toFixed(1)}%)`);
    console.log('='.repeat(80));

    // Calculate average duration
    const avgDuration =
      this.results.reduce((sum, r) => sum + (r.duration || 0), 0) / this.results.length;
    console.log(`\n⏱️  Average Response Time: ${avgDuration.toFixed(0)}ms`);

    // Exit with error code if any tests failed
    if (totalFail > 0) {
      console.log('\n❌ Some tests failed. Please check the errors above.');
      process.exit(1);
    } else {
      console.log('\n✅ All tests passed!');
      process.exit(0);
    }
  }
}

// Run tests
const tester = new APITester();
tester.runAllTests().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
