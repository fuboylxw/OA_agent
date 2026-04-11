#!/usr/bin/env ts-node
/**
 * Bootstrap流程端到端测试
 * 测试完整的OA系统识别、解析、编译、发布流程
 */

import axios, { AxiosInstance } from 'axios';
import * as fs from 'fs';
import * as path from 'path';

const API_BASE_URL = process.env.API_URL || 'http://localhost:3001';
const API_PREFIX = '/api/v1';

class BootstrapFlowTester {
  private client: AxiosInstance;
  private tenantId = 'test-tenant';
  private userId = 'test-user';

  constructor() {
    this.client = axios.create({
      baseURL: `${API_BASE_URL}${API_PREFIX}`,
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json',
        'X-Tenant-ID': this.tenantId,
        'X-User-ID': this.userId,
      },
    });
  }

  private async sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private log(message: string, data?: any) {
    console.log(`[${new Date().toISOString()}] ${message}`);
    if (data) {
      console.log(JSON.stringify(data, null, 2));
    }
  }

  private logSuccess(message: string) {
    console.log(`✅ ${message}`);
  }

  private logError(message: string, error?: any) {
    console.error(`❌ ${message}`);
    if (error) {
      console.error(error);
    }
  }

  private logInfo(message: string) {
    console.log(`ℹ️  ${message}`);
  }

  // Test OpenAPI-type OA
  async testOpenAPITypeOA() {
    console.log('\n' + '='.repeat(80));
    console.log('Testing OpenAPI-type OA Bootstrap Flow');
    console.log('='.repeat(80));

    try {
      // 1. Create bootstrap job
      this.log('Step 1: Creating bootstrap job for OpenAPI-type OA...');
      const createResponse = await this.client.post('/bootstrap/jobs', {
        name: 'OpenAPI Type OA',
        description: 'Test OpenAPI-based OA system',
        sourceType: 'openapi',
        sourceData: {
          url: 'http://example.com/openapi.json',
          spec: {
            openapi: '3.0.0',
            info: { title: 'Test OA API', version: '1.0.0' },
            paths: {
              '/api/submissions': {
                post: {
                  summary: 'Create submission',
                  requestBody: {
                    content: {
                      'application/json': {
                        schema: {
                          type: 'object',
                          properties: {
                            processCode: { type: 'string' },
                            formData: { type: 'object' },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      });

      const jobId = createResponse.data.id;
      this.logSuccess(`Bootstrap job created: ${jobId}`);

      // 2. Wait for job to progress
      this.log('Step 2: Waiting for job to progress through states...');
      let currentState = 'CREATED';
      let attempts = 0;
      const maxAttempts = 20;

      while (currentState !== 'REVIEW' && currentState !== 'PUBLISHED' && attempts < maxAttempts) {
        await this.sleep(2000);
        const statusResponse = await this.client.get(`/bootstrap/jobs/${jobId}`);
        currentState = statusResponse.data.state;
        this.logInfo(`Current state: ${currentState}`);
        attempts++;
      }

      if (currentState === 'REVIEW' || currentState === 'PUBLISHED') {
        this.logSuccess(`Job reached ${currentState} state`);
      } else {
        this.logError(`Job did not reach REVIEW state after ${maxAttempts} attempts`);
        return false;
      }

      // 3. Get OCL report
      this.log('Step 3: Fetching OCL report...');
      try {
        const reportResponse = await this.client.get(`/bootstrap/jobs/${jobId}/report`);
        this.logSuccess('OCL report retrieved');
        this.log('OCL Report:', reportResponse.data);

        // Validate report structure
        const report = reportResponse.data;
        if (
          report.oclLevel &&
          report.coverage !== undefined &&
          report.confidence !== undefined &&
          report.risk &&
          report.evidence &&
          report.recommendation
        ) {
          this.logSuccess('OCL report has all required fields');
        } else {
          this.logError('OCL report is missing required fields');
          return false;
        }
      } catch (error: any) {
        this.logError('Failed to get OCL report', error.message);
      }

      // 4. Publish job (if in REVIEW state)
      if (currentState === 'REVIEW') {
        this.log('Step 4: Publishing bootstrap job...');
        try {
          await this.client.post(`/bootstrap/jobs/${jobId}/publish`);
          this.logSuccess('Bootstrap job published successfully');
        } catch (error: any) {
          this.logError('Failed to publish job', error.message);
          return false;
        }
      }

      // 5. Verify process template created
      this.log('Step 5: Verifying process template created...');
      try {
        const processesResponse = await this.client.get('/processes');
        const processes = processesResponse.data;
        this.logSuccess(`Found ${processes.length} process templates`);
      } catch (error: any) {
        this.logError('Failed to get process templates', error.message);
      }

      return true;
    } catch (error: any) {
      this.logError('Bootstrap flow test failed', error.message);
      return false;
    }
  }

  // Test Form-page-type OA
  async testFormPageTypeOA() {
    console.log('\n' + '='.repeat(80));
    console.log('Testing Form-page-type OA Bootstrap Flow');
    console.log('='.repeat(80));

    try {
      this.log('Step 1: Creating bootstrap job for Form-page-type OA...');
      const createResponse = await this.client.post('/bootstrap/jobs', {
        name: 'Form Page Type OA',
        description: 'Test form-based OA system',
        sourceType: 'har',
        sourceData: {
          url: 'http://example.com/form',
          har: {
            log: {
              version: '1.2',
              creator: { name: 'Test', version: '1.0' },
              entries: [
                {
                  request: {
                    method: 'POST',
                    url: 'http://example.com/submit',
                    headers: [],
                    postData: {
                      mimeType: 'application/x-www-form-urlencoded',
                      params: [
                        { name: 'amount', value: '1000' },
                        { name: 'reason', value: 'test' },
                      ],
                    },
                  },
                  response: {
                    status: 200,
                    headers: [],
                    content: { mimeType: 'text/html', text: '<html></html>' },
                  },
                },
              ],
            },
          },
        },
      });

      const jobId = createResponse.data.id;
      this.logSuccess(`Bootstrap job created: ${jobId}`);

      // Wait for processing
      this.log('Step 2: Waiting for job to process...');
      await this.sleep(5000);

      const statusResponse = await this.client.get(`/bootstrap/jobs/${jobId}`);
      this.logInfo(`Job state: ${statusResponse.data.state}`);

      return true;
    } catch (error: any) {
      this.logError('Form-page bootstrap test failed', error.message);
      return false;
    }
  }

  // Test Hybrid-type OA
  async testHybridTypeOA() {
    console.log('\n' + '='.repeat(80));
    console.log('Testing Hybrid-type OA Bootstrap Flow');
    console.log('='.repeat(80));

    try {
      this.log('Step 1: Creating bootstrap job for Hybrid-type OA...');
      const createResponse = await this.client.post('/bootstrap/jobs', {
        name: 'Hybrid Type OA',
        description: 'Test hybrid OA system (API + Forms)',
        sourceType: 'bundle',
        sourceData: {
          openapi: {
            openapi: '3.0.0',
            info: { title: 'Hybrid OA', version: '1.0.0' },
            paths: {},
          },
          har: {
            log: {
              version: '1.2',
              creator: { name: 'Test', version: '1.0' },
              entries: [],
            },
          },
        },
      });

      const jobId = createResponse.data.id;
      this.logSuccess(`Bootstrap job created: ${jobId}`);

      return true;
    } catch (error: any) {
      this.logError('Hybrid bootstrap test failed', error.message);
      return false;
    }
  }

  // Run all bootstrap tests
  async runAllTests() {
    console.log('🚀 Starting Bootstrap Flow Tests...');
    console.log(`API Base URL: ${API_BASE_URL}${API_PREFIX}`);

    const results = {
      openapi: false,
      formPage: false,
      hybrid: false,
    };

    try {
      results.openapi = await this.testOpenAPITypeOA();
      results.formPage = await this.testFormPageTypeOA();
      results.hybrid = await this.testHybridTypeOA();
    } catch (error) {
      console.error('Test suite failed:', error);
    }

    // Print summary
    console.log('\n' + '='.repeat(80));
    console.log('📊 BOOTSTRAP FLOW TEST SUMMARY');
    console.log('='.repeat(80));
    console.log(`OpenAPI-type OA: ${results.openapi ? '✅ PASS' : '❌ FAIL'}`);
    console.log(`Form-page-type OA: ${results.formPage ? '✅ PASS' : '❌ FAIL'}`);
    console.log(`Hybrid-type OA: ${results.hybrid ? '✅ PASS' : '❌ FAIL'}`);
    console.log('='.repeat(80));

    const allPassed = Object.values(results).every((r) => r);
    if (allPassed) {
      console.log('\n✅ All bootstrap flow tests passed!');
      process.exit(0);
    } else {
      console.log('\n❌ Some bootstrap flow tests failed.');
      process.exit(1);
    }
  }
}

// Run tests
const tester = new BootstrapFlowTester();
tester.runAllTests().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
