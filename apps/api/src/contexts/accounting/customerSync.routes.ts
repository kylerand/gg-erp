import type { CustomerSyncInput, CustomerSyncService } from './customerSync.service.js';

export interface CustomerSyncRoutes {
  queueSync(
    input: CustomerSyncInput,
    correlationId: string,
    actorId?: string
  ): ReturnType<CustomerSyncService['queueSync']>;
  get(recordId: string): ReturnType<CustomerSyncService['getRecord']>;
}

export function createCustomerSyncRoutes(service: CustomerSyncService): CustomerSyncRoutes {
  return {
    queueSync(input, correlationId, actorId) {
      return service.queueSync(input, { correlationId, actorId, module: 'accounting' });
    },
    get(recordId) {
      return service.getRecord(recordId);
    },
  };
}
