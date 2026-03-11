import type { InventoryImplementedRouteContract } from './inventory.api.contracts.js';
import type { InventoryService } from './inventory.service.js';

export type { InventoryApiRouteContract } from './inventory.api.contracts.js';

export type InventoryRoutes = InventoryImplementedRouteContract;

export function createInventoryRoutes(service: InventoryService): InventoryRoutes {
  return {
    createPartSku(input, correlationId, actorId) {
      return service.createPartSku(input, {
        correlationId,
        actorId,
        module: 'inventory'
      });
    },
    receiveLot(input, correlationId, actorId) {
      return service.receiveLot(input, {
        correlationId,
        actorId,
        module: 'inventory'
      });
    },
    reserveLot(lotId, quantity, correlationId, actorId) {
      return service.reserveLotQuantity(lotId, quantity, {
        correlationId,
        actorId,
        module: 'inventory'
      });
    },
    releaseLot(lotId, quantity, correlationId, actorId) {
      return service.releaseLotReservation(lotId, quantity, {
        correlationId,
        actorId,
        module: 'inventory'
      });
    },
    consumeLot(lotId, quantity, correlationId, actorId) {
      return service.consumeReservedQuantity(lotId, quantity, {
        correlationId,
        actorId,
        module: 'inventory'
      });
    }
  };
}
