import type { InventoryImplementedRouteContract } from './inventory.api.contracts.js';
import type { InventoryService } from './inventory.service.js';

export type { InventoryApiRouteContract } from './inventory.api.contracts.js';

export type InventoryRoutes = InventoryImplementedRouteContract;

export function createInventoryRoutes(service: InventoryService): InventoryRoutes {
  const makeContext = (correlationId: string, actorId?: string) => ({
    correlationId,
    actorId,
    module: 'inventory' as const
  });

  return {
    createPartSku(input, correlationId, actorId) {
      return service.createPartSku(input, makeContext(correlationId, actorId));
    },
    updatePartSku(input, correlationId, actorId) {
      return service.updatePartSku(input, makeContext(correlationId, actorId));
    },
    listPartSkus(query, correlationId, actorId) {
      return service.listPartSkus(query, makeContext(correlationId, actorId));
    },
    getPartSku(partSkuId, correlationId, actorId) {
      return service.getPartSku(partSkuId, makeContext(correlationId, actorId));
    },
    getPartChain(partSkuId, correlationId, actorId) {
      return service.getPartChain(partSkuId, makeContext(correlationId, actorId));
    },
    planMaterialByStage(correlationId, actorId) {
      return service.planMaterialByStage(makeContext(correlationId, actorId));
    },
    createManufacturer(input, correlationId, actorId) {
      return service.createManufacturer(input, makeContext(correlationId, actorId));
    },
    updateManufacturer(input, correlationId, actorId) {
      return service.updateManufacturer(input, makeContext(correlationId, actorId));
    },
    listManufacturers(query, correlationId, actorId) {
      return service.listManufacturers(query, makeContext(correlationId, actorId));
    },
    receiveLot(input, correlationId, actorId) {
      return service.receiveLot(input, makeContext(correlationId, actorId));
    },
    reserveLot(lotId, quantity, correlationId, actorId) {
      return service.reserveLotQuantity(lotId, quantity, makeContext(correlationId, actorId));
    },
    releaseLot(lotId, quantity, correlationId, actorId) {
      return service.releaseLotReservation(lotId, quantity, makeContext(correlationId, actorId));
    },
    consumeLot(lotId, quantity, correlationId, actorId) {
      return service.consumeReservedQuantity(lotId, quantity, makeContext(correlationId, actorId));
    }
  };
}
