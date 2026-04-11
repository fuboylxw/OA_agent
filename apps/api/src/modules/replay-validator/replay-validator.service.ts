import { Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';

@Injectable()
export class ReplayValidatorService {
  constructor(private readonly prisma: PrismaService) {}

  async validate(bootstrapJobId: string) {
    const job = await this.prisma.bootstrapJob.findUnique({
      where: { id: bootstrapJobId },
      include: {
        flowIRs: true,
        fieldIRs: true,
      },
    });

    if (!job) {
      throw new Error('Bootstrap job not found');
    }

    // Create replay test cases
    for (const flowIR of job.flowIRs) {
      const fields = job.fieldIRs.filter(f => f.flowCode === flowIR.flowCode);

      // Generate test data
      const testData: Record<string, any> = {};
      for (const field of fields) {
        testData[field.fieldKey] = this.generateTestValue(field.fieldType);
      }

      // Create replay case
      const replayCase = await this.prisma.replayCase.create({
        data: {
          bootstrapJobId: job.id,
          flowCode: flowIR.flowCode,
          testData,
          expectedResult: {
            success: true,
          },
        },
      });

      // Execute replay (mock)
      const result = await this.executeReplay(replayCase.id, testData);

      // Record result
      await this.prisma.replayResult.create({
        data: {
          replayCaseId: replayCase.id,
          status: result.success ? 'success' : 'failed',
          actualResult: result.data,
          errorMessage: result.success ? undefined : 'Replay execution failed',
        },
      });
    }

    return { success: true };
  }

  private generateTestValue(fieldType: string): any {
    switch (fieldType) {
      case 'number':
        return 1000;
      case 'text':
      case 'textarea':
        return 'Test value';
      case 'date':
        return new Date().toISOString().split('T')[0];
      case 'select':
        return 'option1';
      default:
        return 'test';
    }
  }

  private async executeReplay(replayCaseId: string, testData: Record<string, any>) {
    // Mock replay execution
    await new Promise(resolve => setTimeout(resolve, 100));

    return {
      success: true,
      data: {
        submissionId: `REPLAY-${Date.now()}`,
        status: 'submitted',
      },
    };
  }
}
