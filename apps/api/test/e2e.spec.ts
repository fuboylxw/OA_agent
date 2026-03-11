import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/modules/common/prisma.service';

describe('E2E: Bootstrap Flow', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    app.setGlobalPrefix('api/v1');
    await app.init();

    prisma = app.get<PrismaService>(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  it('should complete full bootstrap flow', async () => {
    // Step 1: Create bootstrap job
    const createResponse = await request(app.getHttpServer())
      .post('/api/v1/bootstrap/jobs')
      .send({
        openApiUrl: 'http://localhost:8080/openapi.json',
      })
      .expect(201);

    const jobId = createResponse.body.id;
    expect(jobId).toBeDefined();

    // Step 2: Wait for job to process (in real test, use polling)
    await new Promise(resolve => setTimeout(resolve, 5000));

    // Step 3: Get job status
    const jobResponse = await request(app.getHttpServer())
      .get(`/api/v1/bootstrap/jobs/${jobId}`)
      .expect(200);

    expect(jobResponse.body.status).toBeDefined();

    // Step 4: Get report
    const reportResponse = await request(app.getHttpServer())
      .get(`/api/v1/bootstrap/jobs/${jobId}/report`)
      .expect(200);

    expect(reportResponse.body.oclLevel).toBeDefined();
    expect(reportResponse.body.coverage).toBeGreaterThanOrEqual(0);
    expect(reportResponse.body.confidence).toBeGreaterThanOrEqual(0);
    expect(reportResponse.body.risk).toMatch(/low|medium|high/);
    expect(reportResponse.body.evidence).toBeInstanceOf(Array);
    expect(reportResponse.body.recommendation).toBeDefined();

    // Step 5: If status is REVIEW, publish
    if (jobResponse.body.status === 'REVIEW') {
      const publishResponse = await request(app.getHttpServer())
        .post(`/api/v1/bootstrap/jobs/${jobId}/publish`)
        .expect(201);

      expect(publishResponse.body.success).toBe(true);
      expect(publishResponse.body.connectorId).toBeDefined();
    }
  });

  it('should handle invalid bootstrap input', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/bootstrap/jobs')
      .send({
        openApiUrl: 'invalid-url',
      })
      .expect(400);
  });
});

describe('E2E: Chat to Submit Flow', () => {
  let app: INestApplication;
  let sessionId: string;
  let draftId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    app.setGlobalPrefix('api/v1');
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('should complete chat to submit flow', async () => {
    // Step 1: Start chat - user intent
    const chat1 = await request(app.getHttpServer())
      .post('/api/v1/assistant/chat')
      .send({
        message: '我要报销差旅费',
        userId: 'test-user',
      })
      .expect(201);

    sessionId = chat1.body.sessionId;
    expect(sessionId).toBeDefined();
    expect(chat1.body.message).toBeDefined();

    // Step 2: Provide amount
    const chat2 = await request(app.getHttpServer())
      .post('/api/v1/assistant/chat')
      .send({
        sessionId,
        message: '金额1000元',
        userId: 'test-user',
      })
      .expect(201);

    // Step 3: Provide reason
    const chat3 = await request(app.getHttpServer())
      .post('/api/v1/assistant/chat')
      .send({
        sessionId,
        message: '原因是出差北京',
        userId: 'test-user',
      })
      .expect(201);

    // Step 4: Provide date
    const chat4 = await request(app.getHttpServer())
      .post('/api/v1/assistant/chat')
      .send({
        sessionId,
        message: '日期2024-01-15',
        userId: 'test-user',
      })
      .expect(201);

    draftId = chat4.body.draftId;
    if (draftId) {
      // Step 5: Submit draft
      const submitResponse = await request(app.getHttpServer())
        .post('/api/v1/submissions')
        .send({
          draftId,
          idempotencyKey: `test-${Date.now()}`,
          userId: 'test-user',
        })
        .expect(201);

      expect(submitResponse.body.submissionId).toBeDefined();
      expect(submitResponse.body.status).toBe('pending');
    }
  });

  it('should handle permission denial', async () => {
    const permResponse = await request(app.getHttpServer())
      .post('/api/v1/permission/check')
      .send({
        userId: 'unauthorized-user',
        processCode: 'restricted_flow',
        action: 'submit',
      })
      .expect(201);

    expect(permResponse.body.allowed).toBeDefined();
    if (!permResponse.body.allowed) {
      expect(permResponse.body.reason).toBeDefined();
    }
  });
});

describe('E2E: Submission Actions', () => {
  let app: INestApplication;
  let submissionId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    app.setGlobalPrefix('api/v1');
    await app.init();

    // Create a test submission
    // In real test, this would be set up in beforeEach
    submissionId = 'test-submission-id';
  });

  afterAll(async () => {
    await app.close();
  });

  it('should query submission status', async () => {
    const response = await request(app.getHttpServer())
      .get(`/api/v1/status/submissions/${submissionId}`)
      .expect(200);

    expect(response.body.submissionId).toBe(submissionId);
    expect(response.body.status).toBeDefined();
  });

  it('should list my submissions', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/status/my')
      .query({ tenantId: 'default-tenant', userId: 'test-user' })
      .expect(200);

    expect(Array.isArray(response.body)).toBe(true);
  });
});
