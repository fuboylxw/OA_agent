import { Module } from '@nestjs/common';
import { DiscoveryService } from './discovery.service';
import { OADiscoveryAgent } from './oa-discovery.agent';

@Module({
  providers: [DiscoveryService, OADiscoveryAgent],
  exports: [DiscoveryService],
})
export class DiscoveryModule {}
