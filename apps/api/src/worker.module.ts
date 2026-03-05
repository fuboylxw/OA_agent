import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { ConfigModule } from '@nestjs/config';
import { BootstrapProcessor } from './processors/bootstrap.processor';
import { CommonModule } from './modules/common/common.module';
import { DiscoveryModule } from './modules/discovery/discovery.module';
import { IrNormalizerModule } from './modules/ir-normalizer/ir-normalizer.module';
import { AdapterCompilerModule } from './modules/adapter-compiler/adapter-compiler.module';
import { ReplayValidatorModule } from './modules/replay-validator/replay-validator.module';
import { BootstrapStateMachine } from './modules/bootstrap/bootstrap.state-machine';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    BullModule.forRoot({
      redis: {
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT || '6379', 10),
      },
    }),
    BullModule.registerQueue(
      { name: 'bootstrap' },
      { name: 'parse' },
      { name: 'submit' },
      { name: 'status' },
    ),
    CommonModule,
    DiscoveryModule,
    IrNormalizerModule,
    AdapterCompilerModule,
    ReplayValidatorModule,
  ],
  providers: [BootstrapProcessor, BootstrapStateMachine],
})
export class WorkerModule {}
