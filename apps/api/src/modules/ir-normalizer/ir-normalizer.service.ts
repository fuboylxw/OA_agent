import { Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';

@Injectable()
export class IrNormalizerService {
  constructor(private readonly prisma: PrismaService) {}

  async normalize(bootstrapJobId: string) {
    const job = await this.prisma.bootstrapJob.findUnique({
      where: { id: bootstrapJobId },
      include: { flowIRs: true },
    });

    if (!job) {
      throw new Error('Bootstrap job not found');
    }

    // For each flow, create field IRs, rule IRs, and permission IRs
    for (const flowIR of job.flowIRs) {
      // Create mock field IRs
      await this.createMockFieldIRs(bootstrapJobId, flowIR.flowCode);

      // Create mock rule IRs
      await this.createMockRuleIRs(bootstrapJobId, flowIR.flowCode);

      // Create mock permission IRs
      await this.createMockPermissionIRs(bootstrapJobId, flowIR.flowCode);
    }

    return { success: true };
  }

  private async createMockFieldIRs(bootstrapJobId: string, flowCode: string) {
    const fields = [
      {
        fieldKey: 'amount',
        fieldLabel: '金额',
        fieldType: 'number',
        required: true,
      },
      {
        fieldKey: 'reason',
        fieldLabel: '事由',
        fieldType: 'textarea',
        required: true,
      },
      {
        fieldKey: 'date',
        fieldLabel: '日期',
        fieldType: 'date',
        required: true,
      },
    ];

    for (const field of fields) {
      await this.prisma.fieldIR.create({
        data: {
          bootstrapJobId,
          flowCode,
          ...field,
        },
      });
    }
  }

  private async createMockRuleIRs(bootstrapJobId: string, flowCode: string) {
    await this.prisma.ruleIR.create({
      data: {
        bootstrapJobId,
        flowCode,
        ruleType: 'validation',
        ruleExpression: 'amount > 0',
        errorLevel: 'error',
        errorMessage: '金额必须大于0',
      },
    });
  }

  private async createMockPermissionIRs(bootstrapJobId: string, flowCode: string) {
    await this.prisma.permissionIR.create({
      data: {
        bootstrapJobId,
        flowCode,
        permissionType: 'role',
        permissionRule: 'user.role in ["employee", "manager"]',
      },
    });
  }
}
