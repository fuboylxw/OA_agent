import { Readable } from 'stream';
import { INestApplication, Module, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as request from 'supertest';
import { AttachmentController } from '../src/modules/attachment/attachment.controller';
import { AttachmentService } from '../src/modules/attachment/attachment.service';
import { RequestAuthService } from '../src/modules/common/request-auth.service';

@Module({
  controllers: [AttachmentController],
  providers: [
    {
      provide: AttachmentService,
      useValue: {
        upload: jest.fn(),
        getDownloadResource: jest.fn(),
        getPreviewResource: jest.fn(),
        deleteAttachment: jest.fn(),
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
class AttachmentHttpTestModule {}

describe('Attachment HTTP E2E', () => {
  let app: INestApplication;
  let attachmentService: {
    upload: jest.Mock;
    getDownloadResource: jest.Mock;
    getPreviewResource: jest.Mock;
    deleteAttachment: jest.Mock;
  };
  let requestAuth: { resolveUser: jest.Mock };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AttachmentHttpTestModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    app.setGlobalPrefix('api/v1');
    await app.init();

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

  it('handles upload, download, preview, and delete attachment routes', async () => {
    attachmentService.upload.mockResolvedValue([{ attachmentId: 'att-1' }]);
    attachmentService.getDownloadResource.mockResolvedValue({
      asset: { originalName: 'invoice.pdf', mimeType: 'application/pdf' },
      stream: Readable.from([Buffer.from('download-content')]),
    });
    attachmentService.getPreviewResource.mockResolvedValue({
      asset: {
        originalName: 'invoice.pdf',
        mimeType: 'application/pdf',
        previewKey: 'preview-key',
      },
      storageKey: 'preview-key',
      stream: Readable.from([Buffer.from('preview-content')]),
    });
    attachmentService.deleteAttachment.mockResolvedValue({ deleted: true });

    await request(app.getHttpServer())
      .post('/api/v1/attachments/upload')
      .query({
        tenantId: 'tenant-1',
        userId: 'user-1',
        sessionId: 'session-1',
        fieldKey: 'invoice',
        bindScope: 'field',
      })
      .attach('files', Buffer.from('pdf-content'), 'invoice.pdf')
      .expect(201)
      .expect(({ body }) => {
        expect(body[0].attachmentId).toBe('att-1');
      });

    const downloadResponse = await request(app.getHttpServer())
      .get('/api/v1/attachments/att-1/download')
      .query({ tenantId: 'tenant-1', userId: 'user-1' })
      .expect(200);
    expect(downloadResponse.header['content-type']).toContain('application/pdf');

    const previewResponse = await request(app.getHttpServer())
      .get('/api/v1/attachments/att-1/preview')
      .query({ tenantId: 'tenant-1', userId: 'user-1' })
      .expect(200);
    expect(previewResponse.header['content-disposition']).toContain('inline');

    await request(app.getHttpServer())
      .delete('/api/v1/attachments/att-1')
      .query({ tenantId: 'tenant-1', userId: 'user-1' })
      .expect(200)
      .expect(({ body }) => {
        expect(body.deleted).toBe(true);
      });

    expect(attachmentService.upload).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 'tenant-1',
      userId: 'user-1',
      sessionId: 'session-1',
      fieldKey: 'invoice',
      bindScope: 'field',
      files: expect.any(Array),
    }));
    expect(attachmentService.getDownloadResource).toHaveBeenCalledWith('att-1', 'tenant-1', 'user-1');
    expect(attachmentService.getPreviewResource).toHaveBeenCalledWith('att-1', 'tenant-1', 'user-1');
    expect(attachmentService.deleteAttachment).toHaveBeenCalledWith('att-1', 'tenant-1', 'user-1');
  });
});
