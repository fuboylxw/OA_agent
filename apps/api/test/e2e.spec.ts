import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { issueAuthSessionToken } from '@uniflow/shared-types';
import { AppModule } from '../src/app.module';
import { getAuthSessionSecret } from '../src/modules/common/auth-session-secret';

function createAuthHeader(overrides?: Partial<{
  tenantId: string;
  userId: string;
  username: string;
  displayName: string;
  roles: string[];
}>) {
  const { token } = issueAuthSessionToken({
    tenantId: overrides?.tenantId || 'default-tenant',
    userId: overrides?.userId || 'test-user',
    username: overrides?.username || 'test-user',
    displayName: overrides?.displayName || 'Test User',
    roles: overrides?.roles || ['user'],
  }, getAuthSessionSecret());
  return `Bearer ${token}`;
}

describe('AppModule HTTP smoke', () => {
  let app: INestApplication;

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

  it('keeps the live health endpoint public', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/health/live')
      .expect(200)
      .expect(({ body }) => {
        expect(body.status).toBe('ok');
        expect(body.timestamp).toBeDefined();
      });
  });

  it('rejects protected endpoints without a session token', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/status/my')
      .query({ tenantId: 'default-tenant', userId: 'test-user' })
      .expect(401);
  });

  it('allows protected status queries with a valid session token', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/status/my')
      .set('Authorization', createAuthHeader())
      .query({ tenantId: 'default-tenant', userId: 'test-user' })
      .expect(200)
      .expect(({ body }) => {
        expect(Array.isArray(body)).toBe(true);
      });
  });

  it('continues to DTO validation after auth succeeds', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/bootstrap/jobs')
      .set('Authorization', createAuthHeader())
      .send({
        oaUrl: 'not-a-url',
        bootstrapMode: 'invalid-mode',
      })
      .expect(400);
  });
});
