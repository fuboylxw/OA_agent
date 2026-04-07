import { ApiUploadRepairService } from './api-upload-repair.service';

describe('ApiUploadRepairService', () => {
  let docNormalizer: {
    detectFormat: jest.Mock;
  };
  let apiDocParser: {
    execute: jest.Mock;
  };
  let workflowIdentifier: {
    execute: jest.Mock;
  };
  let service: ApiUploadRepairService;

  beforeEach(() => {
    delete process.env.LLM_PROVIDER;
    delete process.env.LLM_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;

    docNormalizer = {
      detectFormat: jest.fn().mockReturnValue('openapi'),
    };
    apiDocParser = {
      execute: jest.fn().mockResolvedValue({
        success: true,
        data: {
          endpoints: [
            {
              path: '/demo',
              method: 'GET',
              description: 'demo',
              parameters: [],
            },
          ],
        },
      }),
    };
    workflowIdentifier = {
      execute: jest.fn().mockResolvedValue({
        success: true,
        data: {
          workflowApis: [],
        },
      }),
    };

    service = new ApiUploadRepairService(
      docNormalizer as any,
      apiDocParser as any,
      workflowIdentifier as any,
    );
  });

  it('repairs a minimal json document into acceptable openapi content', async () => {
    const result = await service.runRepairLoop({
      tenantId: 'tenant-1',
      connectorId: 'connector-1',
      sourceName: 'openapi.json',
      docType: 'openapi',
      docContent: JSON.stringify({
        paths: {
          '/demo': {
            get: {
              summary: 'demo',
              responses: {
                '200': { description: 'ok' },
              },
            },
          },
        },
      }),
      oaUrl: 'https://oa.example.com',
      maxAttempts: 1,
    });

    expect(result.accepted).toEqual(expect.objectContaining({
      effectiveDocType: 'openapi',
      endpointCount: 1,
    }));
    expect(result.attempts).toHaveLength(1);

    const repaired = JSON.parse(result.attempts[0].content);
    expect(repaired.openapi).toBe('3.0.0');
    expect(repaired.info).toEqual({
      title: 'openapi.json',
      version: '1.0.0',
    });
    expect(repaired.servers).toEqual([{ url: 'https://oa.example.com' }]);
  });
});
