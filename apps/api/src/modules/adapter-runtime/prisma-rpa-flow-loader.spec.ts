import { PrismaRpaFlowLoader } from './prisma-rpa-flow-loader';

describe('PrismaRpaFlowLoader', () => {
  it('prefers runtimeManifest over legacy uiHints when loading flows', async () => {
    const prisma = {
      processTemplate: {
        findMany: jest.fn().mockResolvedValue([
          {
            processCode: 'manifest_first_flow',
            processName: 'Manifest First Flow',
            uiHints: {
              runtimeManifest: {
                version: 1,
                capabilities: {
                  submit: ['url'],
                  queryStatus: [],
                },
                definition: {
                  processCode: 'manifest_first_flow',
                  processName: 'Manifest First Flow',
                  accessMode: 'direct_link',
                  sourceType: 'direct_link',
                  runtime: {
                    networkSubmit: {
                      url: 'https://oa.example.com/api/workflow/submit',
                    },
                  },
                },
              },
              executionModes: {
                submit: ['rpa'],
                queryStatus: ['rpa'],
              },
              rpaDefinition: {
                processCode: 'manifest_first_flow',
                processName: 'Legacy Flow',
                actions: {
                  submit: {
                    steps: [{ type: 'click', selector: '#submit' }],
                  },
                },
              },
            },
          },
        ]),
      },
    };

    const loader = new PrismaRpaFlowLoader(prisma as any);
    const flows = await loader.loadFlows('connector-1');

    expect(prisma.processTemplate.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        connectorId: 'connector-1',
        status: 'published',
      },
    }));
    expect(flows).toEqual([
      expect.objectContaining({
        processCode: 'manifest_first_flow',
        executionModes: {
          submit: ['url'],
          queryStatus: [],
        },
        rpaDefinition: expect.objectContaining({
          processName: 'Manifest First Flow',
          accessMode: 'direct_link',
        }),
      }),
    ]);
  });
});
