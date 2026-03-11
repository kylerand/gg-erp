import {
  PurchaseOrderState
} from '../../../../../packages/domain/src/model/procurement.js';
import type {
  CreatePurchaseOrderInput,
  CreateVendorInput,
  ProcurementService
} from './procurement.service.js';

export interface ProcurementRoutes {
  createVendor(
    input: CreateVendorInput,
    correlationId: string,
    actorId?: string
  ): ReturnType<ProcurementService['createVendor']>;
  createPurchaseOrder(
    input: CreatePurchaseOrderInput,
    correlationId: string,
    actorId?: string
  ): ReturnType<ProcurementService['createPurchaseOrder']>;
  transitionPurchaseOrder(
    purchaseOrderId: string,
    nextState: PurchaseOrderState,
    correlationId: string,
    actorId?: string
  ): ReturnType<ProcurementService['transitionPurchaseOrder']>;
  receivePurchaseOrderLines(
    purchaseOrderId: string,
    received: Array<{ lineId: string; quantity: number }>,
    correlationId: string,
    actorId?: string
  ): ReturnType<ProcurementService['receivePurchaseOrderLines']>;
}

export function createProcurementRoutes(service: ProcurementService): ProcurementRoutes {
  return {
    createVendor(input, correlationId, actorId) {
      return service.createVendor(input, { correlationId, actorId, module: 'inventory' });
    },
    createPurchaseOrder(input, correlationId, actorId) {
      return service.createPurchaseOrder(input, { correlationId, actorId, module: 'inventory' });
    },
    transitionPurchaseOrder(purchaseOrderId, nextState, correlationId, actorId) {
      return service.transitionPurchaseOrder(purchaseOrderId, nextState, {
        correlationId,
        actorId,
        module: 'inventory'
      });
    },
    receivePurchaseOrderLines(purchaseOrderId, received, correlationId, actorId) {
      return service.receivePurchaseOrderLines(purchaseOrderId, received, {
        correlationId,
        actorId,
        module: 'inventory'
      });
    }
  };
}
