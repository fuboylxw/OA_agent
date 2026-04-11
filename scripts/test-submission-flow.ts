#!/usr/bin/env ts-node
/**
 * 提交流程端到端测试
 * 测试从对话到提交的完整流程
 */

import axios, { AxiosInstance } from 'axios';

const API_BASE_URL = process.env.API_URL || 'http://localhost:3001';
const API_PREFIX = '/api/v1';

class SubmissionFlowTester {
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

  private async sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // Test complete submission flow
  async testCompleteSubmissionFlow() {
    console.log('\n' + '='.repeat(80));
    console.log('Testing Complete Submission Flow: Chat → Draft → Submit → Status');
    console.log('='.repeat(80));

    try {
      // Step 1: Create chat session
      this.log('Step 1: Creating chat session...');
      const sessionResponse = await this.client.post('/assistant/sessions', {
        userId: this.userId,
      });
      const sessionId = sessionResponse.data.id;
      this.logSuccess(`Chat session created: ${sessionId}`);

      // Step 2: Send initial message
      this.log('Step 2: Sending message "我要报销差旅费1000元"...');
      const msg1Response = await this.client.post(`/assistant/sessions/${sessionId}/messages`, {
        message: '我要报销差旅费1000元',
      });
      this.logInfo(`Assistant response: ${msg1Response.data.response}`);

      // Step 3: Provide additional information
      this.log('Step 3: Providing reason "出差北京"...');
      const msg2Response = await this.client.post(`/assistant/sessions/${sessionId}/messages`, {
        message: '出差北京',
      });
      this.logInfo(`Assistant response: ${msg2Response.data.response}`);

      // Step 4: Provide date
      this.log('Step 4: Providing date "2024-03-15"...');
      const msg3Response = await this.client.post(`/assistant/sessions/${sessionId}/messages`, {
        message: '2024-03-15',
      });
      this.logInfo(`Assistant response: ${msg3Response.data.response}`);

      // Step 5: Get draft
      this.log('Step 5: Retrieving draft...');
      await this.sleep(1000);
      const draftResponse = await this.client.get(`/assistant/sessions/${sessionId}/draft`);
      const draft = draftResponse.data;
      this.logSuccess('Draft retrieved');
      this.log('Draft data:', draft);

      if (!draft || !draft.processCode) {
        this.logError('Draft is incomplete or missing processCode');
        return false;
      }

      // Step 6: Check permission
      this.log('Step 6: Checking permission...');
      const permissionResponse = await this.client.post('/permissions/check', {
        userId: this.userId,
        processCode: draft.processCode,
        action: 'submit',
      });
      this.logInfo(`Permission check result: ${permissionResponse.data.allowed}`);

      if (!permissionResponse.data.allowed) {
        this.logError(`Permission denied: ${permissionResponse.data.reason}`);
        return false;
      }
      this.logSuccess('Permission granted');

      // Step 7: Validate with rules
      this.log('Step 7: Validating form data with rules...');
      const validationResponse = await this.client.post('/rules/validate', {
        processCode: draft.processCode,
        formData: draft.formData,
      });
      this.logInfo(`Validation result: ${validationResponse.data.valid}`);

      if (!validationResponse.data.valid) {
        this.logError('Validation failed');
        this.log('Validation errors:', validationResponse.data.errors);
        return false;
      }
      this.logSuccess('Validation passed');

      // Step 8: Submit
      this.log('Step 8: Submitting application...');
      const submissionResponse = await this.client.post('/submissions', {
        processCode: draft.processCode,
        formData: draft.formData,
        idempotencyKey: `test-${Date.now()}`,
      });
      const submissionId = submissionResponse.data.id;
      this.logSuccess(`Submission created: ${submissionId}`);

      // Step 9: Test idempotency
      this.log('Step 9: Testing idempotency (resubmit with same key)...');
      try {
        await this.client.post('/submissions', {
          processCode: draft.processCode,
          formData: draft.formData,
          idempotencyKey: submissionResponse.data.idempotencyKey,
        });
        this.logError('Idempotency check failed - duplicate submission allowed');
        return false;
      } catch (error: any) {
        if (error.response && error.response.status === 409) {
          this.logSuccess('Idempotency check passed - duplicate rejected');
        } else {
          this.logError('Unexpected error during idempotency test', error.message);
        }
      }

      // Step 10: Query status
      this.log('Step 10: Querying submission status...');
      await this.sleep(2000);
      const statusResponse = await this.client.get(`/submissions/${submissionId}`);
      this.logSuccess(`Submission status: ${statusResponse.data.status}`);
      this.log('Submission details:', statusResponse.data);

      // Step 11: Get timeline
      this.log('Step 11: Getting status timeline...');
      const timelineResponse = await this.client.get(`/status/timeline/${submissionId}`);
      this.logSuccess(`Timeline has ${timelineResponse.data.length} events`);
      this.log('Timeline:', timelineResponse.data);

      // Step 12: Get available actions
      this.log('Step 12: Getting available actions...');
      const actionsResponse = await this.client.get(`/submissions/${submissionId}/actions`);
      this.logSuccess(`Available actions: ${actionsResponse.data.actions.join(', ')}`);

      // Step 13: Test cancel action
      if (actionsResponse.data.actions.includes('cancel')) {
        this.log('Step 13: Testing cancel action...');
        try {
          await this.client.post(`/submissions/${submissionId}/cancel`);
          this.logSuccess('Submission cancelled successfully');
        } catch (error: any) {
          this.logError('Cancel action failed', error.message);
        }
      }

      // Step 14: Verify audit trail
      this.log('Step 14: Verifying audit trail...');
      const auditResponse = await this.client.get('/audit/logs', {
        params: {
          userId: this.userId,
          limit: 10,
        },
      });
      this.logSuccess(`Found ${auditResponse.data.length} audit logs`);

      return true;
    } catch (error: any) {
      this.logError('Submission flow test failed', error.message);
      if (error.response) {
        this.log('Error response:', error.response.data);
      }
      return false;
    }
  }

  // Test action matrix
  async testActionMatrix() {
    console.log('\n' + '='.repeat(80));
    console.log('Testing Action Matrix: Cancel, Urge, Supplement, Delegate');
    console.log('='.repeat(80));

    try {
      // Create a test submission
      this.log('Creating test submission...');
      const submissionResponse = await this.client.post('/submissions', {
        processCode: 'EXPENSE_CLAIM',
        formData: {
          amount: 500,
          reason: 'Test action matrix',
          date: '2024-03-15',
        },
        idempotencyKey: `action-test-${Date.now()}`,
      });
      const submissionId = submissionResponse.data.id;
      this.logSuccess(`Test submission created: ${submissionId}`);

      // Test urge action
      this.log('Testing urge action...');
      try {
        await this.client.post(`/submissions/${submissionId}/urge`);
        this.logSuccess('Urge action executed');
      } catch (error: any) {
        this.logInfo(`Urge action: ${error.response?.data?.message || error.message}`);
      }

      // Test supplement action
      this.log('Testing supplement action...');
      try {
        await this.client.post(`/submissions/${submissionId}/supplement`, {
          files: ['file1.pdf', 'file2.pdf'],
          comment: 'Additional documents',
        });
        this.logSuccess('Supplement action executed');
      } catch (error: any) {
        this.logInfo(`Supplement action: ${error.response?.data?.message || error.message}`);
      }

      // Test delegate action
      this.log('Testing delegate action...');
      try {
        await this.client.post(`/submissions/${submissionId}/delegate`, {
          targetUserId: 'other-user',
          comment: 'Delegating to colleague',
        });
        this.logSuccess('Delegate action executed');
      } catch (error: any) {
        this.logInfo(`Delegate action: ${error.response?.data?.message || error.message}`);
      }

      // Test cancel action
      this.log('Testing cancel action...');
      try {
        await this.client.post(`/submissions/${submissionId}/cancel`);
        this.logSuccess('Cancel action executed');
      } catch (error: any) {
        this.logInfo(`Cancel action: ${error.response?.data?.message || error.message}`);
      }

      return true;
    } catch (error: any) {
      this.logError('Action matrix test failed', error.message);
      return false;
    }
  }

  // Test my submissions list
  async testMySubmissions() {
    console.log('\n' + '='.repeat(80));
    console.log('Testing My Submissions List');
    console.log('='.repeat(80));

    try {
      this.log('Fetching my submissions...');
      const response = await this.client.get('/status/my-submissions', {
        params: {
          page: 1,
          limit: 10,
        },
      });

      this.logSuccess(`Found ${response.data.total} submissions`);
      this.log('Submissions:', response.data.items);

      return true;
    } catch (error: any) {
      this.logError('My submissions test failed', error.message);
      return false;
    }
  }

  // Run all tests
  async runAllTests() {
    console.log('🚀 Starting Submission Flow Tests...');
    console.log(`API Base URL: ${API_BASE_URL}${API_PREFIX}`);

    const results = {
      completeFlow: false,
      actionMatrix: false,
      mySubmissions: false,
    };

    try {
      results.completeFlow = await this.testCompleteSubmissionFlow();
      results.actionMatrix = await this.testActionMatrix();
      results.mySubmissions = await this.testMySubmissions();
    } catch (error) {
      console.error('Test suite failed:', error);
    }

    // Print summary
    console.log('\n' + '='.repeat(80));
    console.log('📊 SUBMISSION FLOW TEST SUMMARY');
    console.log('='.repeat(80));
    console.log(`Complete Flow: ${results.completeFlow ? '✅ PASS' : '❌ FAIL'}`);
    console.log(`Action Matrix: ${results.actionMatrix ? '✅ PASS' : '❌ FAIL'}`);
    console.log(`My Submissions: ${results.mySubmissions ? '✅ PASS' : '❌ FAIL'}`);
    console.log('='.repeat(80));

    const allPassed = Object.values(results).every((r) => r);
    if (allPassed) {
      console.log('\n✅ All submission flow tests passed!');
      process.exit(0);
    } else {
      console.log('\n❌ Some submission flow tests failed.');
      process.exit(1);
    }
  }
}

// Run tests
const tester = new SubmissionFlowTester();
tester.runAllTests().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
