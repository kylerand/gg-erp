import type { HttpClient } from '../../lib/http-client.js';

export interface InventoryLotSummary {
  id: string;
  lotNumber: string;
  quantityOnHand: number;
  quantityReserved: number;
}

export async function fetchInventoryLots(client: HttpClient): Promise<InventoryLotSummary[]> {
  return client.get<InventoryLotSummary[]>('/inventory/lots');
}
