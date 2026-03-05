import { Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { OADiscoveryAgent } from './oa-discovery.agent';

@Injectable()
export class DiscoveryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly discoveryAgent: OADiscoveryAgent,
  ) {}

  async discover(bootstrapJobId: string) {
    const job = await this.prisma.bootstrapJob.findUnique({
      where: { id: bootstrapJobId },
      include: { sources: true },
    });

    if (!job) {
      throw new Error('Bootstrap job not found');
    }

    const result = await this.discoveryAgent.execute(
      {
        oaUrl: job.oaUrl,
        sourceBundleUrl: job.sourceBundleUrl,
        openApiUrl: job.openApiUrl,
        harFileUrl: job.harFileUrl,
      },
      {
        tenantId: job.tenantId,
        traceId: `discover-${job.id}`,
      },
    );

    if (!result.success || !result.data) {
      throw new Error(result.error || 'Discovery failed');
    }

    // Create FlowIRs from discovered flows
    for (const flow of result.data.discoveredFlows) {
      await this.prisma.flowIR.create({
        data: {
          bootstrapJobId: job.id,
          flowCode: flow.flowCode,
          flowName: flow.flowName,
          entryUrl: flow.entryUrl,
          submitUrl: flow.submitUrl,
          queryUrl: flow.queryUrl,
        },
      });
    }

    // Create bootstrap report
    await this.prisma.bootstrapReport.create({
      data: {
        bootstrapJobId: job.id,
        oclLevel: result.data.oclLevel,
        coverage: 0.8,
        confidence: result.data.confidence,
        risk: 'medium',
        evidence: [
          {
            type: 'discovery',
            description: `Discovered ${result.data.discoveredFlows.length} flows`,
            confidence: result.data.confidence,
          },
        ],
        recommendation: `OA system identified as ${result.data.oaVendor} with ${result.data.oclLevel} compatibility`,
      },
    });

    return result.data;
  }
}
