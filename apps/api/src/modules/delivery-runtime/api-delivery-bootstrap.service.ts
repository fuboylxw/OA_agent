import { Injectable } from '@nestjs/common';
import { AdapterRuntimeService } from '../adapter-runtime/adapter-runtime.service';
import type { ApiDeliveryExecutionContext } from './delivery-bootstrap.types';

@Injectable()
export class ApiDeliveryBootstrapService {
  constructor(private readonly adapterRuntimeService: AdapterRuntimeService) {}

  async prepare(input: {
    connectorId: string;
    processCode: string;
    processName: string;
    tenantId?: string;
    userId?: string;
  }): Promise<ApiDeliveryExecutionContext> {
    const adapter = await this.adapterRuntimeService.createApiAdapterForConnector(
      input.connectorId,
      [{ flowCode: input.processCode, flowName: input.processName }],
      {
        tenantId: input.tenantId,
        userId: input.userId,
      },
    );

    return {
      path: 'api',
      adapter,
    };
  }
}
