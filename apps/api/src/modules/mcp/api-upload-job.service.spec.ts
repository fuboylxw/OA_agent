import { BadRequestException } from '@nestjs/common';
import { ApiUploadJobService } from './api-upload-job.service';

describe('ApiUploadJobService', () => {
  let prisma: any;
  let repairService: {
    runRepairLoop: jest.Mock;
  };
  let apiUploadService: {
    uploadAndProcess: jest.Mock;
  };
  let service: ApiUploadJobService;

  beforeEach(() => {
    prisma = {
      connector: {
        findUnique: jest.fn(),
      },
      apiUploadJob: {
        create: jest.fn(),
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        update: jest.fn(),
      },
      apiUploadAttempt: {
        create: jest.fn(),
        findMany: jest.fn(),
      },
    };
    repairService = {
      runRepairLoop: jest.fn(),
    };
    apiUploadService = {
      uploadAndProcess: jest.fn(),
    };

    service = new ApiUploadJobService(
      prisma,
      repairService as any,
      apiUploadService as any,
    );
  });

  it('routes legacy upload through repair and persists accepted attempts', async () => {
    prisma.connector.findUnique.mockResolvedValue({
      id: 'connector-1',
      tenantId: 'tenant-1',
      baseUrl: 'https://oa.example.com',
    });
    prisma.apiUploadJob.create.mockResolvedValue({
      id: 'job-1',
    });
    prisma.apiUploadJob.findUnique.mockResolvedValue({
      id: 'job-1',
      tenantId: 'tenant-1',
      connectorId: 'connector-1',
      sourceName: 'openapi.json',
      sourceContent: '{"paths":{}}',
      docType: 'openapi',
      oaUrl: 'https://oa.example.com',
      authConfig: { token: 'secret-token' },
      autoValidate: true,
      autoGenerateMcp: false,
    });
    repairService.runRepairLoop.mockResolvedValue({
      attempts: [
        {
          stage: 'repairing_deterministic',
          strategy: 'deterministic',
          content: '{"openapi":"3.0.0","paths":{"/demo":{"get":{"responses":{"200":{"description":"ok"}}}}}}',
          actions: [
            {
              action: 'add_openapi_version',
              reason: 'repair',
              applied: true,
            },
          ],
          evaluation: {
            effectiveDocType: 'openapi',
            parseSuccess: true,
            endpointCount: 1,
            workflowCount: 0,
            validationScore: 0.6,
            diagnostics: {
              formatDetected: 'openapi',
              parseErrors: [],
              schemaErrors: [],
              refErrors: [],
              missingFields: [],
              suspiciousSections: [],
              severity: 'low',
            },
          },
        },
      ],
      accepted: {
        content: '{"openapi":"3.0.0","paths":{"/demo":{"get":{"responses":{"200":{"description":"ok"}}}}}}',
        effectiveDocType: 'openapi',
        endpointCount: 1,
        workflowCount: 0,
        validationScore: 0.6,
      },
    });
    apiUploadService.uploadAndProcess.mockResolvedValue({
      uploadId: 'upload-1',
      totalEndpoints: 1,
      workflowEndpoints: 0,
      validatedEndpoints: 0,
      generatedMcpTools: 0,
      workflowApis: [],
      validationResults: [],
      mcpTools: [],
    });

    const result = await service.uploadAndProcessWithRepair({
      tenantId: 'tenant-1',
      connectorId: 'connector-1',
      sourceName: 'openapi.json',
      docType: 'openapi',
      docContent: '{"paths":{}}',
      oaUrl: 'https://oa.example.com',
      authConfig: { token: 'secret-token' },
      autoValidate: true,
      autoGenerateMcp: false,
    });

    expect(apiUploadService.uploadAndProcess).toHaveBeenCalledWith(
      expect.objectContaining({
        docType: 'openapi',
        docContent: '{"openapi":"3.0.0","paths":{"/demo":{"get":{"responses":{"200":{"description":"ok"}}}}}}',
      }),
    );
    expect(prisma.apiUploadAttempt.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          jobId: 'job-1',
          attemptNo: 1,
          decision: 'accepted',
          parseSuccess: true,
          endpointCount: 1,
        }),
      }),
    );
    expect(result).toEqual(expect.objectContaining({
      jobId: 'job-1',
      totalEndpoints: 1,
      repair: expect.objectContaining({
        accepted: true,
        attemptCount: 1,
        acceptedDocType: 'openapi',
      }),
    }));
  });

  it('marks the job as failed when repair loop cannot accept the document', async () => {
    prisma.connector.findUnique.mockResolvedValue({
      id: 'connector-1',
      tenantId: 'tenant-1',
      baseUrl: 'https://oa.example.com',
    });
    prisma.apiUploadJob.create.mockResolvedValue({
      id: 'job-1',
    });
    prisma.apiUploadJob.findUnique
      .mockResolvedValueOnce({
        id: 'job-1',
        tenantId: 'tenant-1',
        connectorId: 'connector-1',
        sourceContent: '{"broken":true}',
        docType: 'openapi',
        oaUrl: 'https://oa.example.com',
        authConfig: null,
        autoValidate: false,
        autoGenerateMcp: false,
      })
      .mockResolvedValueOnce({
        status: 'FAILED',
      });
    repairService.runRepairLoop.mockResolvedValue({
      attempts: [
        {
          stage: 'repairing_deterministic',
          strategy: 'deterministic',
          content: '{"broken":true}',
          actions: [],
          evaluation: {
            effectiveDocType: 'openapi',
            parseSuccess: false,
            endpointCount: 0,
            workflowCount: 0,
            validationScore: 0,
            diagnostics: {
              formatDetected: 'openapi',
              parseErrors: ['bad json'],
              schemaErrors: [],
              refErrors: [],
              missingFields: ['paths'],
              suspiciousSections: ['json_parse_failed'],
              severity: 'high',
            },
            parseError: 'bad json',
          },
        },
      ],
      finalErrorType: 'parse_failed_after_repair',
      finalErrorMessage: 'Automatic repair failed',
    });

    await expect(service.uploadAndProcessWithRepair({
      tenantId: 'tenant-1',
      connectorId: 'connector-1',
      docType: 'openapi',
      docContent: '{"broken":true}',
      oaUrl: 'https://oa.example.com',
      authConfig: null,
      autoValidate: false,
      autoGenerateMcp: false,
    })).rejects.toBeInstanceOf(BadRequestException);

    expect(prisma.apiUploadJob.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'job-1' },
        data: expect.objectContaining({
          status: 'FAILED',
          finalDecision: 'rejected',
          finalErrorType: 'parse_failed_after_repair',
        }),
      }),
    );
    expect(apiUploadService.uploadAndProcess).not.toHaveBeenCalled();
  });
});
