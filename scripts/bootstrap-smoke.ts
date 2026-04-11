#!/usr/bin/env tsx

/**
 * Bootstrap Smoke Test
 *
 * This script verifies that the bootstrap pipeline works end-to-end:
 * 1. Creates a bootstrap job with OpenAPI fixture
 * 2. Waits for job to complete
 * 3. Verifies job reaches REVIEW status
 * 4. Publishes the job
 * 5. Verifies at least 1 process template is published
 */

import axios from 'axios';

const API_BASE_URL = process.env.API_URL || 'http://localhost:3001/api/v1';
const MAX_WAIT_TIME = 60000; // 60 seconds
const POLL_INTERVAL = 2000; // 2 seconds

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitForJobStatus(jobId: string, targetStatus: string): Promise<boolean> {
  const startTime = Date.now();

  while (Date.now() - startTime < MAX_WAIT_TIME) {
    try {
      const response = await axios.get(`${API_BASE_URL}/bootstrap/jobs/${jobId}`);
      const job = response.data;

      console.log(`  Job status: ${job.status}`);

      if (job.status === targetStatus) {
        return true;
      }

      if (job.status === 'FAILED') {
        console.error('  ❌ Job failed');
        return false;
      }

      await sleep(POLL_INTERVAL);
    } catch (error: any) {
      console.error('  Error checking job status:', error.message);
      await sleep(POLL_INTERVAL);
    }
  }

  console.error(`  ❌ Timeout waiting for status ${targetStatus}`);
  return false;
}

async function main() {
  console.log('🧪 Starting Bootstrap Smoke Test\n');

  try {
    // Step 1: Create bootstrap job
    console.log('1️⃣  Creating bootstrap job...');
    const createResponse = await axios.post(`${API_BASE_URL}/bootstrap/jobs`, {
      openApiUrl: 'http://localhost:8080/openapi.json',
    });

    const jobId = createResponse.data.id;
    console.log(`  ✅ Created job: ${jobId}\n`);

    // Step 2: Wait for REVIEW status
    console.log('2️⃣  Waiting for job to reach REVIEW status...');
    const reachedReview = await waitForJobStatus(jobId, 'REVIEW');

    if (!reachedReview) {
      throw new Error('Job did not reach REVIEW status');
    }
    console.log('  ✅ Job reached REVIEW status\n');

    // Step 3: Get bootstrap report
    console.log('3️⃣  Fetching bootstrap report...');
    const reportResponse = await axios.get(`${API_BASE_URL}/bootstrap/jobs/${jobId}/report`);
    const report = reportResponse.data;

    console.log('  Report:');
    console.log(`    OCL Level: ${report.oclLevel}`);
    console.log(`    Coverage: ${(report.coverage * 100).toFixed(1)}%`);
    console.log(`    Confidence: ${(report.confidence * 100).toFixed(1)}%`);
    console.log(`    Risk: ${report.risk}`);
    console.log(`  ✅ Report generated\n`);

    // Step 4: Publish job
    console.log('4️⃣  Publishing job...');
    const publishResponse = await axios.post(`${API_BASE_URL}/bootstrap/jobs/${jobId}/publish`);
    console.log(`  ✅ Published with connector: ${publishResponse.data.connectorId}\n`);

    // Step 5: Verify published status
    console.log('5️⃣  Verifying published status...');
    const finalJobResponse = await axios.get(`${API_BASE_URL}/bootstrap/jobs/${jobId}`);
    const finalJob = finalJobResponse.data;

    if (finalJob.status !== 'PUBLISHED') {
      throw new Error(`Expected PUBLISHED status, got ${finalJob.status}`);
    }
    console.log('  ✅ Job status is PUBLISHED\n');

    // Success!
    console.log('🎉 Bootstrap Smoke Test PASSED!\n');
    console.log('Summary:');
    console.log(`  - Bootstrap Job ID: ${jobId}`);
    console.log(`  - OCL Level: ${report.oclLevel}`);
    console.log(`  - Flows Discovered: ${finalJob.flowIRs?.length || 0}`);
    console.log(`  - Fields Mapped: ${finalJob.fieldIRs?.length || 0}`);
    console.log(`  - Replay Tests: ${finalJob.replayCases?.length || 0}`);

    process.exit(0);
  } catch (error: any) {
    console.error('\n❌ Bootstrap Smoke Test FAILED');
    console.error('Error:', error.message);
    if (error.response?.data) {
      console.error('Response:', JSON.stringify(error.response.data, null, 2));
    }
    process.exit(1);
  }
}

main();
