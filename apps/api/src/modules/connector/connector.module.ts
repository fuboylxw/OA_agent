import { Module } from '@nestjs/common';
import { ConnectorController } from './connector.controller';
import { ConnectorService } from './connector.service';
import { AdapterRuntimeModule } from '../adapter-runtime/adapter-runtime.module';

@Module({
  imports: [AdapterRuntimeModule],
  controllers: [ConnectorController],
  providers: [ConnectorService],
  exports: [ConnectorService],
})
export class ConnectorModule {}
