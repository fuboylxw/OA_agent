/**
 * @deprecated 此 Processor 已废弃，bootstrap 流水线已统一由 apps/worker 中的 BootstrapProcessor 处理。
 * 保留此文件仅供参考，请勿在任何 Module 中注册此 Processor。
 */
import { Process, Processor } from '@nestjs/bull';
import { Job } from 'bull';
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../modules/common/prisma.service';
import { DiscoveryService } from '../modules/discovery/discovery.service';
import { IrNormalizerService } from '../modules/ir-normalizer/ir-normalizer.service';
import { AdapterCompilerService } from '../modules/adapter-compiler/adapter-compiler.service';
import { ReplayValidatorService } from '../modules/replay-validator/replay-validator.service';
import { BootstrapStateMachine } from '../modules/bootstrap/bootstrap.state-machine';

@Processor('bootstrap')
@Injectable()
export class BootstrapProcessor {
  constructor(
    private readonly prisma: PrismaService,
    private readonly discoveryService: DiscoveryService,
    private readonly irNormalizer: IrNormalizerService,
    private readonly adapterCompiler: AdapterCompilerService,
    private readonly replayValidator: ReplayValidatorService,
    private readonly stateMachine: BootstrapStateMachine,
  ) {}

  @Process('process')
  async handleBootstrap(job: Job<{ jobId: string }>) {
    const { jobId } = job.data;

    try {
      // CREATED -> DISCOVERING
      await this.transitionState(jobId, 'START_DISCOVERY');
      await this.discoveryService.discover(jobId);
      await this.transitionState(jobId, 'DISCOVERY_COMPLETE');

      // PARSING (skip for now, already done in discovery)
      await this.transitionState(jobId, 'START_PARSING');
      await this.transitionState(jobId, 'PARSING_COMPLETE');

      // NORMALIZING
      await this.transitionState(jobId, 'START_NORMALIZING');
      await this.irNormalizer.normalize(jobId);
      await this.transitionState(jobId, 'NORMALIZING_COMPLETE');

      // COMPILING
      await this.transitionState(jobId, 'START_COMPILING');
      await this.adapterCompiler.compile(jobId);
      await this.transitionState(jobId, 'COMPILING_COMPLETE');

      // REPLAYING
      await this.transitionState(jobId, 'START_REPLAYING');
      await this.replayValidator.validate(jobId);
      await this.transitionState(jobId, 'REPLAYING_COMPLETE');

      return { success: true };
    } catch (error: any) {
      await this.transitionState(jobId, 'FAIL');
      throw error;
    }
  }

  private async transitionState(jobId: string, event: string) {
    const job = await this.prisma.bootstrapJob.findUnique({ where: { id: jobId } });
    if (!job) throw new Error('Job not found');

    const newState = this.stateMachine.transition(job.status, event);
    await this.prisma.bootstrapJob.update({
      where: { id: jobId },
      data: { status: newState },
    });
  }
}
