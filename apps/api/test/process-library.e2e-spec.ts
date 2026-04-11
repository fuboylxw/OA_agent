import { INestApplication, Module, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as request from 'supertest';
import { ProcessLibraryController } from '../src/modules/process-library/process-library.controller';
import { ProcessLibraryService } from '../src/modules/process-library/process-library.service';
import { RequestAuthService } from '../src/modules/common/request-auth.service';

@Module({
  controllers: [ProcessLibraryController],
  providers: [
    {
      provide: ProcessLibraryService,
      useValue: {
        list: jest.fn(),
        getByCode: jest.fn(),
        getById: jest.fn(),
        listVersions: jest.fn(),
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
class ProcessLibraryHttpTestModule {}

describe('ProcessLibrary HTTP E2E', () => {
  let app: INestApplication;
  let httpApp: any;
  let processLibraryService: {
    list: jest.Mock;
    getByCode: jest.Mock;
    getById: jest.Mock;
    listVersions: jest.Mock;
  };
  let requestAuth: { resolveUser: jest.Mock };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [ProcessLibraryHttpTestModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    app.setGlobalPrefix('api/v1');
    await app.init();

    httpApp = app.getHttpAdapter().getInstance();
    processLibraryService = moduleFixture.get(ProcessLibraryService);
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

  it('routes list, detail, id lookup, and version endpoints with tenant context', async () => {
    processLibraryService.list.mockResolvedValue([{ processCode: 'expense_apply' }]);
    processLibraryService.getByCode.mockResolvedValue({ processCode: 'expense_apply', version: 2 });
    processLibraryService.getById.mockResolvedValue({ id: 'tpl-1', processCode: 'expense_apply' });
    processLibraryService.listVersions.mockResolvedValue([{ version: 1 }, { version: 2 }]);

    await request(httpApp)
      .get('/api/v1/process-library')
      .query({ tenantId: 'tenant-1', category: 'finance' })
      .expect(200)
      .expect(({ body }) => {
        expect(body).toHaveLength(1);
      });

    await request(httpApp)
      .get('/api/v1/process-library/expense_apply')
      .query({ tenantId: 'tenant-1', version: '2' })
      .expect(200)
      .expect(({ body }) => {
        expect(body.version).toBe(2);
      });

    await request(httpApp)
      .get('/api/v1/process-library/id/tpl-1')
      .expect(200)
      .expect(({ body }) => {
        expect(body.id).toBe('tpl-1');
      });

    await request(httpApp)
      .get('/api/v1/process-library/expense_apply/versions')
      .query({ tenantId: 'tenant-1' })
      .expect(200)
      .expect(({ body }) => {
        expect(body).toHaveLength(2);
      });

    expect(processLibraryService.list).toHaveBeenCalledWith('tenant-1', 'finance');
    expect(processLibraryService.getByCode).toHaveBeenCalledWith('tenant-1', 'expense_apply', 2);
    expect(processLibraryService.getById).toHaveBeenCalledWith('tpl-1', 'tenant-1');
    expect(processLibraryService.listVersions).toHaveBeenCalledWith('tenant-1', 'expense_apply');
  });
});
