import { Module } from '@nestjs/common';
import { ConnectorController } from './connector.controller';
import { ConnectorService } from './connector.service';
import { AdapterRuntimeModule } from '../adapter-runtime/adapter-runtime.module';
import { AuthBindingModule } from '../auth-binding/auth-binding.module';

@Module({
  imports: [AdapterRuntimeModule, AuthBindingModule],
  controllers: [ConnectorController],
  providers: [ConnectorService],
  exports: [ConnectorService],
})
export class ConnectorModule {}
