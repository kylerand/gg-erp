import type { CreateInvoiceSyncInput, InvoiceSyncService } from './invoiceSync.service.js';

export interface InvoiceSyncRoutes {
  create(
    input: CreateInvoiceSyncInput,
    correlationId: string,
    actorId?: string
  ): ReturnType<InvoiceSyncService['createRecord']>;
  start(
    recordId: string,
    correlationId: string,
    actorId?: string
  ): ReturnType<InvoiceSyncService['startSync']>;
  success(
    recordId: string,
    externalReference: string,
    correlationId: string,
    actorId?: string
  ): ReturnType<InvoiceSyncService['markSuccess']>;
  fail(
    recordId: string,
    errorCode: string,
    errorMessage: string,
    correlationId: string,
    actorId?: string
  ): ReturnType<InvoiceSyncService['markFailure']>;
  get(recordId: string): ReturnType<InvoiceSyncService['getRecord']>;
}

export function createInvoiceSyncRoutes(service: InvoiceSyncService): InvoiceSyncRoutes {
  return {
    create(input, correlationId, actorId) {
      return service.createRecord(input, { correlationId, actorId, module: 'accounting' });
    },
    start(recordId, correlationId, actorId) {
      return service.startSync(recordId, { correlationId, actorId, module: 'accounting' });
    },
    success(recordId, externalReference, correlationId, actorId) {
      return service.markSuccess(recordId, externalReference, {
        correlationId,
        actorId,
        module: 'accounting'
      });
    },
    fail(recordId, errorCode, errorMessage, correlationId, actorId) {
      return service.markFailure(recordId, errorCode, errorMessage, {
        correlationId,
        actorId,
        module: 'accounting'
      });
    },
    get(recordId) {
      return service.getRecord(recordId);
    }
  };
}
