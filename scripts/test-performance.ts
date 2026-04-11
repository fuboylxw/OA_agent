#!/usr/bin/env ts-node
/**
 * 性能测试脚本
 * 测试关键接口的响应时间和并发能力
 */

import axios, { AxiosInstance } from 'axios';

const API_BASE_URL = process.env.API_URL || 'http://localhost:3001';
const API_PREFIX = '/api/v1';

interface PerformanceMetrics {
  endpoint: string;
  method: string;
  totalRequests: number;
  successCount: number;
  failureCount: number;
  avgResponseTime: number;
  minResponseTime: number;
  maxResponseTime: number;
  p50: number;
  p95: number;
  p99: number;
  throughput: number; // requests per second
}

class PerformanceTester {
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
      validateStatus: () => true,
    });
  }

  private async makeRequest(
    method: string,
    endpoint: string,
    data?: any
  ): Promise<{ success: boolean; duration: number }> {
    const startTime = Date.now();
    try {
      const response = await this.client.request({
        method,
        url: endpoint,
        data,
      });
      const duration = Date.now() - startTime;
      return {
        success: response.status >= 200 && response.status < 300,
        duration,
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      return { success: false, duration };
    }
  }

  private calculateMetrics(
    endpoint: string,
    method: string,
    results: { success: boolean; duration: number }[],
    totalTime: number
  ): PerformanceMetrics {
    const durations = results.map((r) => r.duration).sort((a, b) => a - b);
    const successCount = results.filter((r) => r.success).length;
    const failureCount = results.length - successCount;

    const sum = durations.reduce((a, b) => a + b, 0);
    const avg = sum / durations.length;

    const p50Index = Math.floor(durations.length * 0.5);
    const p95Index = Math.floor(durations.length * 0.95);
    const p99Index = Math.floor(durations.length * 0.99);

    return {
      endpoint,
      method,
      totalRequests: results.length,
      successCount,
      failureCount,
      avgResponseTime: Math.round(avg),
      minResponseTime: durations[0],
      maxResponseTime: durations[durations.length - 1],
      p50: durations[p50Index],
      p95: durations[p95Index],
      p99: durations[p99Index],
      throughput: Math.round((results.length / totalTime) * 1000),
    };
  }

  private printMetrics(metrics: PerformanceMetrics) {
    console.log(`\n${'='.repeat(80)}`);
    console.log(`Endpoint: ${metrics.method} ${metrics.endpoint}`);
    console.log(`${'='.repeat(80)}`);
    console.log(`Total Requests: ${metrics.totalRequests}`);
    console.log(`Success: ${metrics.successCount} (${((metrics.successCount / metrics.totalRequests) * 100).toFixed(1)}%)`);
    console.log(`Failure: ${metrics.failureCount} (${((metrics.failureCount / metrics.totalRequests) * 100).toFixed(1)}%)`);
    console.log(`\nResponse Times (ms):`);
    console.log(`  Min: ${metrics.minResponseTime}ms`);
    console.log(`  Avg: ${metrics.avgResponseTime}ms`);
    console.log(`  Max: ${metrics.maxResponseTime}ms`);
    console.log(`  P50: ${metrics.p50}ms`);
    console.log(`  P95: ${metrics.p95}ms`);
    console.log(`  P99: ${metrics.p99}ms`);
    console.log(`\nThroughput: ${metrics.throughput} req/s`);

    // Check against requirements
    const requirements = {
      'POST /assistant/sessions/:id/messages': { p95: 3000, name: 'Chat → Draft' },
      'POST /submissions': { p95: 2000, name: 'Draft → Submit' },
    };

    const key = `${metrics.method} ${metrics.endpoint}`;
    if (requirements[key]) {
      const req = requirements[key];
      const passed = metrics.p95 <= req.p95;
      console.log(`\n${req.name} Requirement: P95 <= ${req.p95}ms`);
      console.log(`Result: ${passed ? '✅ PASS' : '❌ FAIL'} (P95: ${metrics.p95}ms)`);
    }
  }

  // Test chat to draft performance
  async testChatToDraft(concurrency: number = 10, iterations: number = 50) {
    console.log(`\n🚀 Testing Chat → Draft Performance (${concurrency} concurrent, ${iterations} iterations)`);

    const results: { success: boolean; duration: number }[] = [];
    const startTime = Date.now();

    // Create sessions first
    const sessions: string[] = [];
    for (let i = 0; i < concurrency; i++) {
      try {
        const response = await this.client.post('/assistant/sessions', {
          userId: `${this.userId}-${i}`,
        });
        if (response.data && response.data.id) {
          sessions.push(response.data.id);
        }
      } catch (error) {
        console.error('Failed to create session:', error);
      }
    }

    console.log(`Created ${sessions.length} chat sessions`);

    // Run concurrent requests
    const promises: Promise<void>[] = [];
    for (let i = 0; i < iterations; i++) {
      const sessionId = sessions[i % sessions.length];
      const promise = this.makeRequest('POST', `/assistant/sessions/${sessionId}/messages`, {
        message: `我要报销差旅费${1000 + i}元`,
      }).then((result) => {
        results.push(result);
      });
      promises.push(promise);

      // Stagger requests slightly
      if (i % concurrency === 0) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }

    await Promise.all(promises);
    const totalTime = Date.now() - startTime;

    const metrics = this.calculateMetrics(
      '/assistant/sessions/:id/messages',
      'POST',
      results,
      totalTime
    );
    this.printMetrics(metrics);

    return metrics;
  }

  // Test draft to submit performance
  async testDraftToSubmit(concurrency: number = 10, iterations: number = 50) {
    console.log(`\n🚀 Testing Draft → Submit Performance (${concurrency} concurrent, ${iterations} iterations)`);

    const results: { success: boolean; duration: number }[] = [];
    const startTime = Date.now();

    // Run concurrent requests
    const promises: Promise<void>[] = [];
    for (let i = 0; i < iterations; i++) {
      const promise = this.makeRequest('POST', '/submissions', {
        processCode: 'EXPENSE_CLAIM',
        formData: {
          amount: 1000 + i,
          reason: `Test submission ${i}`,
          date: '2024-03-15',
        },
        idempotencyKey: `perf-test-${Date.now()}-${i}`,
      }).then((result) => {
        results.push(result);
      });
      promises.push(promise);

      // Stagger requests slightly
      if (i % concurrency === 0) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }

    await Promise.all(promises);
    const totalTime = Date.now() - startTime;

    const metrics = this.calculateMetrics('/submissions', 'POST', results, totalTime);
    this.printMetrics(metrics);

    return metrics;
  }

  // Test read operations
  async testReadOperations(concurrency: number = 50, iterations: number = 100) {
    console.log(`\n🚀 Testing Read Operations (${concurrency} concurrent, ${iterations} iterations)`);

    const endpoints = [
      { method: 'GET', url: '/processes', name: 'List Processes' },
      { method: 'GET', url: '/submissions', name: 'List Submissions' },
      { method: 'GET', url: '/status/my-submissions', name: 'My Submissions' },
      { method: 'GET', url: '/audit/logs', name: 'Audit Logs' },
    ];

    for (const endpoint of endpoints) {
      const results: { success: boolean; duration: number }[] = [];
      const startTime = Date.now();

      const promises: Promise<void>[] = [];
      for (let i = 0; i < iterations; i++) {
        const promise = this.makeRequest(endpoint.method, endpoint.url).then((result) => {
          results.push(result);
        });
        promises.push(promise);

        if (i % concurrency === 0) {
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
      }

      await Promise.all(promises);
      const totalTime = Date.now() - startTime;

      const metrics = this.calculateMetrics(endpoint.url, endpoint.method, results, totalTime);
      this.printMetrics(metrics);
    }
  }

  // Test concurrent load
  async testConcurrentLoad(concurrency: number = 500) {
    console.log(`\n🚀 Testing Concurrent Load (${concurrency} concurrent requests)`);

    const results: { success: boolean; duration: number }[] = [];
    const startTime = Date.now();

    const promises: Promise<void>[] = [];
    for (let i = 0; i < concurrency; i++) {
      const promise = this.makeRequest('GET', '/health').then((result) => {
        results.push(result);
      });
      promises.push(promise);
    }

    await Promise.all(promises);
    const totalTime = Date.now() - startTime;

    const metrics = this.calculateMetrics('/health', 'GET', results, totalTime);
    this.printMetrics(metrics);

    // Check 99% success rate requirement
    const successRate = (metrics.successCount / metrics.totalRequests) * 100;
    console.log(`\nConcurrency Requirement: 99% success rate at ${concurrency} concurrent`);
    console.log(`Result: ${successRate >= 99 ? '✅ PASS' : '❌ FAIL'} (${successRate.toFixed(1)}%)`);

    return metrics;
  }

  // Run all performance tests
  async runAllTests() {
    console.log('🚀 Starting Performance Tests...');
    console.log(`API Base URL: ${API_BASE_URL}${API_PREFIX}`);

    try {
      // Test critical paths
      await this.testChatToDraft(10, 50);
      await this.testDraftToSubmit(10, 50);

      // Test read operations
      await this.testReadOperations(50, 100);

      // Test concurrent load
      await this.testConcurrentLoad(500);

      console.log('\n' + '='.repeat(80));
      console.log('✅ Performance tests completed!');
      console.log('='.repeat(80));
    } catch (error) {
      console.error('❌ Performance tests failed:', error);
      process.exit(1);
    }
  }
}

// Run tests
const tester = new PerformanceTester();
tester.runAllTests().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
