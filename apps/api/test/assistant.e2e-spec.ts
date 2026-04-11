import { INestApplication, Module, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as request from 'supertest';
import { AssistantController } from '../src/modules/assistant/assistant.controller';
import { AssistantService } from '../src/modules/assistant/assistant.service';
import { AttachmentService } from '../src/modules/attachment/attachment.service';
import { RequestAuthService } from '../src/modules/common/request-auth.service';

@Module({
  controllers: [AssistantController],
  providers: [
    {
      provide: AssistantService,
      useValue: {
        chat: jest.fn(),
        listSessions: jest.fn(),
        getMessages: jest.fn(),
        deleteSession: jest.fn(),
        resetSession: jest.fn(),
      },
    },
    {
      provide: AttachmentService,
      useValue: {
        upload: jest.fn(),
      },
    },
    {
      provide: RequestAuthService,
      useValue: {
        resolveUser: jest.fn(),
      },
    },
  ],
})
class AssistantHttpTestModule {}

describe('Assistant HTTP E2E', () => {
  let app: INestApplication;
  let assistantService: {
    chat: jest.Mock;
    listSessions: jest.Mock;
    getMessages: jest.Mock;
    deleteSession: jest.Mock;
    resetSession: jest.Mock;
  };
  let attachmentService: { upload: jest.Mock };
  let requestAuth: { resolveUser: jest.Mock };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AssistantHttpTestModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    app.setGlobalPrefix('api/v1');
    await app.init();

    assistantService = moduleFixture.get(AssistantService);
    attachmentService = moduleFixture.get(AttachmentService);
    requestAuth = moduleFixture.get(RequestAuthService);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    requestAuth.resolveUser.mockResolvedValue({
      tenantId: 'tenant-1',
      userId: 'user-1',
      roles: ['user'],
      source: 'session',
    });
  });

  it('routes chat and session management endpoints through the resolved user context', async () => {
    assistantService.chat.mockResolvedValue({
      sessionId: 'session-1',
      message: 'next step',
      needsInput: true,
    });
    assistantService.listSessions.mockResolvedValue([{ id: 'session-1' }]);
    assistantService.getMessages.mockResolvedValue([{ id: 'msg-1', role: 'assistant' }]);
    assistantService.deleteSession.mockResolvedValue(undefined);
    assistantService.resetSession.mockResolvedValue(undefined);

    await request(app.getHttpServer())
      .post('/api/v1/assistant/chat')
      .send({
        tenantId: 'tenant-1',
        userId: 'user-1',
        message: 'help me submit an expense',
      })
      .expect(201)
      .expect(({ body }) => {
        expect(body.sessionId).toBe('session-1');
      });

    await request(app.getHttpServer())
      .get('/api/v1/assistant/sessions')
      .query({ tenantId: 'tenant-1', userId: 'user-1' })
      .expect(200)
      .expect(({ body }) => {
        expect(body).toHaveLength(1);
      });

    await request(app.getHttpServer())
      .get('/api/v1/assistant/sessions/session-1/messages')
      .expect(200)
      .expect(({ body }) => {
        expect(body).toHaveLength(1);
      });

    await request(app.getHttpServer())
      .delete('/api/v1/assistant/sessions/session-1')
      .expect(200)
      .expect(({ body }) => {
        expect(body.success).toBe(true);
      });

    await request(app.getHttpServer())
      .post('/api/v1/assistant/sessions/session-1/reset')
      .expect(201)
      .expect(({ body }) => {
        expect(body.success).toBe(true);
      });

    expect(assistantService.chat).toHaveBeenCalledWith({
      tenantId: 'tenant-1',
      userId: 'user-1',
      sessionId: undefined,
      message: 'help me submit an expense',
      attachments: undefined,
    });
    expect(assistantService.listSessions).toHaveBeenCalledWith('tenant-1', 'user-1');
    expect(assistantService.getMessages).toHaveBeenCalledWith('session-1', 'tenant-1', 'user-1');
    expect(assistantService.deleteSession).toHaveBeenCalledWith('session-1', 'tenant-1', 'user-1');
    expect(assistantService.resetSession).toHaveBeenCalledWith('session-1', 'tenant-1', 'user-1');
  });

  it('routes assistant file uploads through attachment service', async () => {
    attachmentService.upload.mockResolvedValue([{ attachmentId: 'att-1' }]);

    await request(app.getHttpServer())
      .post('/api/v1/assistant/upload')
      .query({
        tenantId: 'tenant-1',
        userId: 'user-1',
        sessionId: 'session-1',
        fieldKey: 'invoice',
        bindScope: 'field',
      })
      .attach('files', Buffer.from('invoice-content'), 'invoice.pdf')
      .expect(201)
      .expect(({ body }) => {
        expect(body[0].attachmentId).toBe('att-1');
      });

    expect(attachmentService.upload).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 'tenant-1',
      userId: 'user-1',
      sessionId: 'session-1',
      fieldKey: 'invoice',
      bindScope: 'field',
      files: expect.any(Array),
    }));
  });
});
