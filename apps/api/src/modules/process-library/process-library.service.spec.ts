import { ProcessLibraryService } from './process-library.service';
import { PrismaService } from '../common/prisma.service';

describe('ProcessLibraryService', () => {
  let service: ProcessLibraryService;
  let prisma: {
    processTemplate: { findMany: jest.Mock };
    bootstrapJob: { findMany: jest.Mock };
  };

  beforeEach(() => {
    prisma = {
      processTemplate: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'template-1',
            processCode: 'leave_request',
            processName: 'Leave Application',
            processCategory: 'hr',
            status: 'published',
            falLevel: 'F2',
            uiHints: null,
            createdAt: new Date('2026-03-24T00:00:00.000Z'),
            updatedAt: new Date('2026-03-24T00:00:00.000Z'),
            connector: null,
          },
        ]),
      },
      bootstrapJob: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'job-1',
            status: 'VALIDATION_FAILED',
            name: 'bootstrap',
            oaUrl: null,
            openApiUrl: null,
            createdAt: new Date('2026-03-24T00:00:00.000Z'),
            updatedAt: new Date('2026-03-24T00:00:00.000Z'),
            flowIRs: [
              {
                id: 'flow-1',
                flowCode: 'expense_submit',
                flowName: 'Expense Submit',
                flowCategory: 'finance',
                metadata: {
                  validation: {
                    status: 'failed',
                  },
                },
                createdAt: new Date('2026-03-24T00:00:00.000Z'),
              },
            ],
          },
        ]),
      },
    };

    service = new ProcessLibraryService(prisma as unknown as PrismaService);
  });

  it('normalizes english process names before returning process library items', async () => {
    const items = await service.list('tenant-1');

    expect(items).toEqual(expect.arrayContaining([
      expect.objectContaining({
        processCode: 'leave_request',
        processName: '请假申请',
        sourceType: 'published',
      }),
      expect.objectContaining({
        processCode: 'expense_submit',
        processName: '费用报销',
        sourceType: 'bootstrap_candidate',
      }),
    ]));
  });
});
