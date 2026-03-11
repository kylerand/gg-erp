import type { EntityDesign } from './shared.js';

export enum PartSkuState {
  ACTIVE = 'ACTIVE',
  INACTIVE = 'INACTIVE',
  DISCONTINUED = 'DISCONTINUED'
}

export interface PartSku {
  id: string;
  sku: string;
  state: PartSkuState;
  name: string;
  description?: string;
  unitOfMeasure: 'EACH' | 'BOX' | 'KIT';
  reorderPoint: number;
  createdAt: string;
  updatedAt: string;
}

export const PartSkuDesign: EntityDesign<PartSkuState> = {
  entity: 'PartSku',
  purpose: 'Canonical purchasable/consumable part definition used across planning and inventory.',
  keyFields: [
    'id',
    'sku',
    'state',
    'name',
    'unitOfMeasure',
    'reorderPoint',
    'updatedAt'
  ],
  requiredIndexes: [
    { name: 'part_skus_sku_uk', fields: ['sku'], unique: true },
    { name: 'part_skus_state_idx', fields: ['state'] }
  ],
  lifecycle: {
    initial: PartSkuState.ACTIVE,
    terminal: [PartSkuState.DISCONTINUED],
    transitions: [
      { from: PartSkuState.ACTIVE, to: PartSkuState.INACTIVE, rule: 'Temporarily suspended' },
      { from: PartSkuState.INACTIVE, to: PartSkuState.ACTIVE, rule: 'Reactivated' },
      {
        from: PartSkuState.ACTIVE,
        to: PartSkuState.DISCONTINUED,
        rule: 'Cannot be used for new procurement/plans'
      },
      {
        from: PartSkuState.INACTIVE,
        to: PartSkuState.DISCONTINUED,
        rule: 'Retired from catalog permanently'
      }
    ]
  },
  businessRules: [
    'SKU must be globally unique.',
    'DISCONTINUED SKU cannot be added to new purchase orders.',
    'reorderPoint must be non-negative.'
  ],
  emittedEvents: ['part.sku.created', 'part.sku.updated', 'part.sku.state_changed'],
  apiOperations: [
    { method: 'POST', path: '/inventory/parts', summary: 'Create part SKU' },
    { method: 'GET', path: '/inventory/parts/:id', summary: 'Get part SKU' },
    { method: 'PATCH', path: '/inventory/parts/:id', summary: 'Update part SKU' }
  ]
};

export enum InventoryLocationState {
  ACTIVE = 'ACTIVE',
  INACTIVE = 'INACTIVE'
}

export interface InventoryLocation {
  id: string;
  code: string;
  state: InventoryLocationState;
  name: string;
  zone: string;
  createdAt: string;
  updatedAt: string;
}

export const InventoryLocationDesign: EntityDesign<InventoryLocationState> = {
  entity: 'InventoryLocation',
  purpose: 'Physical warehouse/workshop location used for stock ownership and picking.',
  keyFields: ['id', 'code', 'state', 'name', 'zone', 'updatedAt'],
  requiredIndexes: [
    { name: 'inventory_locations_code_uk', fields: ['code'], unique: true },
    { name: 'inventory_locations_state_idx', fields: ['state'] }
  ],
  lifecycle: {
    initial: InventoryLocationState.ACTIVE,
    terminal: [InventoryLocationState.INACTIVE],
    transitions: [
      {
        from: InventoryLocationState.ACTIVE,
        to: InventoryLocationState.INACTIVE,
        rule: 'Location closed or temporarily unavailable'
      },
      {
        from: InventoryLocationState.INACTIVE,
        to: InventoryLocationState.ACTIVE,
        rule: 'Location reopened'
      }
    ]
  },
  businessRules: [
    'Location code is immutable after creation.',
    'Inactive locations cannot receive new lots or reservations.'
  ],
  emittedEvents: ['inventory.location.created', 'inventory.location.state_changed'],
  apiOperations: [
    { method: 'POST', path: '/inventory/locations', summary: 'Create inventory location' },
    { method: 'PATCH', path: '/inventory/locations/:id/state', summary: 'Set location state' }
  ]
};

export enum InventoryBinState {
  OPEN = 'OPEN',
  QUARANTINED = 'QUARANTINED',
  CLOSED = 'CLOSED'
}

export interface InventoryBin {
  id: string;
  locationId: string;
  code: string;
  state: InventoryBinState;
  capacityUnits?: number;
  createdAt: string;
  updatedAt: string;
}

export const InventoryBinDesign: EntityDesign<InventoryBinState> = {
  entity: 'InventoryBin',
  purpose: 'Sub-location storage unit used for lot-level picking and quarantine.',
  keyFields: ['id', 'locationId', 'code', 'state', 'capacityUnits', 'updatedAt'],
  requiredIndexes: [
    { name: 'inventory_bins_location_code_uk', fields: ['locationId', 'code'], unique: true },
    { name: 'inventory_bins_state_idx', fields: ['state'] }
  ],
  lifecycle: {
    initial: InventoryBinState.OPEN,
    terminal: [InventoryBinState.CLOSED],
    transitions: [
      { from: InventoryBinState.OPEN, to: InventoryBinState.QUARANTINED, rule: 'Quality hold' },
      { from: InventoryBinState.QUARANTINED, to: InventoryBinState.OPEN, rule: 'Quality release' },
      { from: InventoryBinState.OPEN, to: InventoryBinState.CLOSED, rule: 'Bin retired' },
      {
        from: InventoryBinState.QUARANTINED,
        to: InventoryBinState.CLOSED,
        rule: 'Bin retired while quarantined'
      }
    ]
  },
  businessRules: [
    'Bin must belong to an ACTIVE location.',
    'Closed bins cannot accept or reserve inventory.'
  ],
  emittedEvents: ['inventory.bin.created', 'inventory.bin.state_changed'],
  apiOperations: [
    { method: 'POST', path: '/inventory/bins', summary: 'Create inventory bin' },
    { method: 'PATCH', path: '/inventory/bins/:id/state', summary: 'Set bin state' }
  ]
};

export enum InventoryLotState {
  RECEIVED = 'RECEIVED',
  AVAILABLE = 'AVAILABLE',
  RESERVED = 'RESERVED',
  CONSUMED = 'CONSUMED',
  QUARANTINED = 'QUARANTINED'
}

export interface InventoryLot {
  id: string;
  lotNumber: string;
  partSkuId: string;
  locationId: string;
  binId: string;
  quantityOnHand: number;
  quantityReserved: number;
  state: InventoryLotState;
  receivedAt: string;
  expiresAt?: string;
  updatedAt: string;
}

export const InventoryLotDesign: EntityDesign<InventoryLotState> = {
  entity: 'InventoryLot',
  purpose: 'Track lot-level quantities, reservation, and traceability for production consumption.',
  keyFields: [
    'id',
    'lotNumber',
    'partSkuId',
    'locationId',
    'binId',
    'quantityOnHand',
    'quantityReserved',
    'state',
    'receivedAt'
  ],
  requiredIndexes: [
    { name: 'inventory_lots_lot_number_uk', fields: ['lotNumber'], unique: true },
    { name: 'inventory_lots_part_state_idx', fields: ['partSkuId', 'state'] },
    { name: 'inventory_lots_location_bin_idx', fields: ['locationId', 'binId'] }
  ],
  lifecycle: {
    initial: InventoryLotState.RECEIVED,
    terminal: [InventoryLotState.CONSUMED],
    transitions: [
      { from: InventoryLotState.RECEIVED, to: InventoryLotState.AVAILABLE, rule: 'Inspection passed' },
      { from: InventoryLotState.AVAILABLE, to: InventoryLotState.RESERVED, rule: 'Inventory reserved' },
      { from: InventoryLotState.RESERVED, to: InventoryLotState.AVAILABLE, rule: 'Reservation released' },
      {
        from: InventoryLotState.RESERVED,
        to: InventoryLotState.CONSUMED,
        rule: 'Reservation consumed by work order'
      },
      { from: InventoryLotState.AVAILABLE, to: InventoryLotState.QUARANTINED, rule: 'Quality hold raised' },
      {
        from: InventoryLotState.QUARANTINED,
        to: InventoryLotState.AVAILABLE,
        rule: 'Quality hold released'
      }
    ]
  },
  businessRules: [
    'quantityReserved must be <= quantityOnHand.',
    'Only AVAILABLE or RECEIVED lots can be reserved.',
    'CONSUMED lot has quantityOnHand = 0.'
  ],
  emittedEvents: [
    'inventory.lot.received',
    'inventory.lot.reserved',
    'inventory.lot.released',
    'inventory.lot.consumed',
    'inventory.shortage_detected'
  ],
  apiOperations: [
    { method: 'POST', path: '/inventory/lots', summary: 'Receive inventory lot' },
    { method: 'PATCH', path: '/inventory/lots/:id/reserve', summary: 'Reserve lot quantity' },
    { method: 'PATCH', path: '/inventory/lots/:id/release', summary: 'Release reserved quantity' },
    { method: 'PATCH', path: '/inventory/lots/:id/consume', summary: 'Consume reserved quantity' }
  ]
};
