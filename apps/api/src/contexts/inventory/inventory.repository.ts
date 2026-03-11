import {
  type InventoryLot,
  type PartSku
} from '../../../../../packages/domain/src/model/inventory.js';
import {
  type PurchaseOrder,
  type Vendor
} from '../../../../../packages/domain/src/model/procurement.js';
import type {
  CycleCountSessionContract,
  InventoryAllocationContract,
  InventoryBalanceQuery,
  InventoryBalanceRecord,
  InventoryBinContract,
  InventoryLedgerEntryContract,
  InventoryLedgerQuery,
  InventoryLedgerQueryResponse,
  InventoryLocationContract,
  PartSubstitutionContract,
  PurchaseOrderInventoryLinkContract,
  UnitOfMeasureContract,
  UnitOfMeasureConversionContract,
  WorkOrderConsumptionContract
} from './inventory.api.contracts.js';

export type InventoryReservationState = 'ACTIVE' | 'RELEASED' | 'CONSUMED';

export interface InventoryReservationRecord {
  id: string;
  lotId: string;
  partSkuId: string;
  requestedQuantity: number;
  quantity: number;
  allocatedQuantity: number;
  workOrderId?: string;
  demandReference?: string;
  state: InventoryReservationState;
  createdAt: string;
  updatedAt: string;
}

export interface InventoryAllocationRecord extends InventoryAllocationContract {
  lotId: string;
  partSkuId: string;
  workOrderId?: string;
  quantityConsumed: number;
  updatedAt: string;
}

export interface InventoryRepository {
  listPartSkus(): Promise<PartSku[]>;
  findPartSkuById(id: string): Promise<PartSku | undefined>;
  findPartSkuBySku(sku: string): Promise<PartSku | undefined>;
  savePartSku(part: PartSku): Promise<void>;

  listLots(): Promise<InventoryLot[]>;
  findLotById(id: string): Promise<InventoryLot | undefined>;
  findLotByNumber(lotNumber: string): Promise<InventoryLot | undefined>;
  saveLot(lot: InventoryLot): Promise<void>;

  findPartSubstitution(
    partSkuId: string,
    substitutePartSkuId: string
  ): Promise<PartSubstitutionContract | undefined>;
  listPartSubstitutions(partSkuId: string): Promise<PartSubstitutionContract[]>;
  savePartSubstitution(substitution: PartSubstitutionContract): Promise<void>;

  findUnitOfMeasureByCode(code: string): Promise<UnitOfMeasureContract | undefined>;
  saveUnitOfMeasure(unit: UnitOfMeasureContract): Promise<void>;
  findUnitConversion(
    partSkuId: string | undefined,
    fromUnitCode: string,
    toUnitCode: string
  ): Promise<UnitOfMeasureConversionContract | undefined>;
  saveUnitConversion(conversion: UnitOfMeasureConversionContract): Promise<void>;

  findLocationById(id: string): Promise<InventoryLocationContract | undefined>;
  findLocationByCode(code: string): Promise<InventoryLocationContract | undefined>;
  saveLocation(location: InventoryLocationContract): Promise<void>;

  findBinById(id: string): Promise<InventoryBinContract | undefined>;
  findBinByCode(locationId: string, code: string): Promise<InventoryBinContract | undefined>;
  saveBin(bin: InventoryBinContract): Promise<void>;

  findReservationById(id: string): Promise<InventoryReservationRecord | undefined>;
  listReservationsByLot(lotId: string): Promise<InventoryReservationRecord[]>;
  listReservationsByWorkOrder(workOrderId: string): Promise<InventoryReservationRecord[]>;
  saveReservation(reservation: InventoryReservationRecord): Promise<void>;

  findAllocationById(id: string): Promise<InventoryAllocationRecord | undefined>;
  listAllocationsByReservation(reservationId: string): Promise<InventoryAllocationRecord[]>;
  listAllocationsByWorkOrder(workOrderId: string): Promise<InventoryAllocationRecord[]>;
  saveAllocation(allocation: InventoryAllocationRecord): Promise<void>;

  saveWorkOrderConsumption(consumption: WorkOrderConsumptionContract): Promise<void>;
  listWorkOrderConsumptions(workOrderId: string): Promise<WorkOrderConsumptionContract[]>;

  findBalance(
    partSkuId: string,
    locationId: string,
    binId?: string,
    lotId?: string
  ): Promise<InventoryBalanceRecord | undefined>;
  saveBalance(balance: InventoryBalanceRecord): Promise<void>;
  listBalances(query: InventoryBalanceQuery): Promise<InventoryBalanceRecord[]>;

  findCycleCountSessionById(id: string): Promise<CycleCountSessionContract | undefined>;
  saveCycleCountSession(session: CycleCountSessionContract): Promise<void>;

  findPurchaseOrderInventoryLink(
    purchaseOrderId: string
  ): Promise<PurchaseOrderInventoryLinkContract | undefined>;
  savePurchaseOrderInventoryLink(link: PurchaseOrderInventoryLinkContract): Promise<void>;

  appendLedgerEntry(entry: InventoryLedgerEntryContract): Promise<void>;
  queryLedgerEntries(query: InventoryLedgerQuery): Promise<InventoryLedgerQueryResponse>;

  findVendorById(id: string): Promise<Vendor | undefined>;
  findVendorByCode(vendorCode: string): Promise<Vendor | undefined>;
  saveVendor(vendor: Vendor): Promise<void>;

  findPurchaseOrderById(id: string): Promise<PurchaseOrder | undefined>;
  findPurchaseOrderByNumber(poNumber: string): Promise<PurchaseOrder | undefined>;
  savePurchaseOrder(po: PurchaseOrder): Promise<void>;
}

export class InMemoryInventoryRepository implements InventoryRepository {
  private readonly partSkus = new Map<string, PartSku>();
  private readonly lots = new Map<string, InventoryLot>();
  private readonly partSubstitutions = new Map<string, PartSubstitutionContract>();
  private readonly unitsOfMeasure = new Map<string, UnitOfMeasureContract>();
  private readonly unitConversions = new Map<string, UnitOfMeasureConversionContract>();
  private readonly locations = new Map<string, InventoryLocationContract>();
  private readonly bins = new Map<string, InventoryBinContract>();
  private readonly reservations = new Map<string, InventoryReservationRecord>();
  private readonly allocations = new Map<string, InventoryAllocationRecord>();
  private readonly workOrderConsumptions = new Map<string, WorkOrderConsumptionContract>();
  private readonly balances = new Map<string, InventoryBalanceRecord>();
  private readonly cycleCountSessions = new Map<string, CycleCountSessionContract>();
  private readonly purchaseOrderLinks = new Map<string, PurchaseOrderInventoryLinkContract>();
  private readonly ledgerEntries: InventoryLedgerEntryContract[] = [];
  private readonly vendors = new Map<string, Vendor>();
  private readonly purchaseOrders = new Map<string, PurchaseOrder>();

  async listPartSkus(): Promise<PartSku[]> {
    return [...this.partSkus.values()];
  }

  async findPartSkuById(id: string): Promise<PartSku | undefined> {
    return this.partSkus.get(id);
  }

  async findPartSkuBySku(sku: string): Promise<PartSku | undefined> {
    return [...this.partSkus.values()].find((part) => part.sku === sku);
  }

  async savePartSku(part: PartSku): Promise<void> {
    this.partSkus.set(part.id, part);
  }

  async listLots(): Promise<InventoryLot[]> {
    return [...this.lots.values()];
  }

  async findLotById(id: string): Promise<InventoryLot | undefined> {
    return this.lots.get(id);
  }

  async findLotByNumber(lotNumber: string): Promise<InventoryLot | undefined> {
    const normalizedLotNumber = lotNumber.trim();
    return [...this.lots.values()].find((lot) => lot.lotNumber === normalizedLotNumber);
  }

  async saveLot(lot: InventoryLot): Promise<void> {
    this.lots.set(lot.id, lot);
  }

  async findPartSubstitution(
    partSkuId: string,
    substitutePartSkuId: string
  ): Promise<PartSubstitutionContract | undefined> {
    return this.partSubstitutions.get(this.substitutionKey(partSkuId, substitutePartSkuId));
  }

  async listPartSubstitutions(partSkuId: string): Promise<PartSubstitutionContract[]> {
    return [...this.partSubstitutions.values()]
      .filter((substitution) => substitution.partSkuId === partSkuId)
      .sort((left, right) => left.priority - right.priority);
  }

  async savePartSubstitution(substitution: PartSubstitutionContract): Promise<void> {
    this.partSubstitutions.set(
      this.substitutionKey(substitution.partSkuId, substitution.substitutePartSkuId),
      substitution
    );
  }

  async findUnitOfMeasureByCode(code: string): Promise<UnitOfMeasureContract | undefined> {
    return this.unitsOfMeasure.get(this.normalizedCode(code));
  }

  async saveUnitOfMeasure(unit: UnitOfMeasureContract): Promise<void> {
    this.unitsOfMeasure.set(this.normalizedCode(unit.code), {
      ...unit,
      code: this.normalizedCode(unit.code)
    });
  }

  async findUnitConversion(
    partSkuId: string | undefined,
    fromUnitCode: string,
    toUnitCode: string
  ): Promise<UnitOfMeasureConversionContract | undefined> {
    const specific = this.unitConversions.get(
      this.conversionKey(partSkuId, fromUnitCode, toUnitCode)
    );
    if (specific) {
      return specific;
    }
    if (partSkuId !== undefined) {
      return this.unitConversions.get(this.conversionKey(undefined, fromUnitCode, toUnitCode));
    }
    return undefined;
  }

  async saveUnitConversion(conversion: UnitOfMeasureConversionContract): Promise<void> {
    this.unitConversions.set(
      this.conversionKey(conversion.partSkuId, conversion.fromUnitCode, conversion.toUnitCode),
      {
        ...conversion,
        fromUnitCode: this.normalizedCode(conversion.fromUnitCode),
        toUnitCode: this.normalizedCode(conversion.toUnitCode)
      }
    );
  }

  async findLocationById(id: string): Promise<InventoryLocationContract | undefined> {
    return this.locations.get(id);
  }

  async findLocationByCode(code: string): Promise<InventoryLocationContract | undefined> {
    const normalizedCode = this.normalizedCode(code);
    return [...this.locations.values()].find((location) => this.normalizedCode(location.code) === normalizedCode);
  }

  async saveLocation(location: InventoryLocationContract): Promise<void> {
    this.locations.set(location.id, location);
  }

  async findBinById(id: string): Promise<InventoryBinContract | undefined> {
    return this.bins.get(id);
  }

  async findBinByCode(locationId: string, code: string): Promise<InventoryBinContract | undefined> {
    const normalizedCode = this.normalizedCode(code);
    return [...this.bins.values()].find(
      (bin) => bin.locationId === locationId && this.normalizedCode(bin.code) === normalizedCode
    );
  }

  async saveBin(bin: InventoryBinContract): Promise<void> {
    this.bins.set(bin.id, bin);
  }

  async findReservationById(id: string): Promise<InventoryReservationRecord | undefined> {
    return this.reservations.get(id);
  }

  async listReservationsByLot(lotId: string): Promise<InventoryReservationRecord[]> {
    return [...this.reservations.values()]
      .filter((reservation) => reservation.lotId === lotId)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  }

  async listReservationsByWorkOrder(workOrderId: string): Promise<InventoryReservationRecord[]> {
    return [...this.reservations.values()]
      .filter((reservation) => reservation.workOrderId === workOrderId)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  }

  async saveReservation(reservation: InventoryReservationRecord): Promise<void> {
    this.reservations.set(reservation.id, reservation);
  }

  async findAllocationById(id: string): Promise<InventoryAllocationRecord | undefined> {
    return this.allocations.get(id);
  }

  async listAllocationsByReservation(reservationId: string): Promise<InventoryAllocationRecord[]> {
    return [...this.allocations.values()]
      .filter((allocation) => allocation.reservationId === reservationId)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  }

  async listAllocationsByWorkOrder(workOrderId: string): Promise<InventoryAllocationRecord[]> {
    return [...this.allocations.values()]
      .filter(
        (allocation) => allocation.targetType === 'WORK_ORDER' && allocation.targetId === workOrderId
      )
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  }

  async saveAllocation(allocation: InventoryAllocationRecord): Promise<void> {
    this.allocations.set(allocation.id, allocation);
  }

  async saveWorkOrderConsumption(consumption: WorkOrderConsumptionContract): Promise<void> {
    this.workOrderConsumptions.set(consumption.id, consumption);
  }

  async listWorkOrderConsumptions(workOrderId: string): Promise<WorkOrderConsumptionContract[]> {
    return [...this.workOrderConsumptions.values()]
      .filter((consumption) => consumption.workOrderId === workOrderId)
      .sort((left, right) => left.consumedAt.localeCompare(right.consumedAt));
  }

  async findBalance(
    partSkuId: string,
    locationId: string,
    binId?: string,
    lotId?: string
  ): Promise<InventoryBalanceRecord | undefined> {
    return this.balances.get(this.balanceKey(partSkuId, locationId, binId, lotId));
  }

  async saveBalance(balance: InventoryBalanceRecord): Promise<void> {
    this.balances.set(
      this.balanceKey(balance.partSkuId, balance.locationId, balance.binId, balance.lotId),
      balance
    );
  }

  async listBalances(query: InventoryBalanceQuery): Promise<InventoryBalanceRecord[]> {
    return [...this.balances.values()].filter((balance) => {
      if (query.partSkuId && balance.partSkuId !== query.partSkuId) {
        return false;
      }
      if (query.locationId && balance.locationId !== query.locationId) {
        return false;
      }
      if (query.binId && balance.binId !== query.binId) {
        return false;
      }
      if (query.lotId && balance.lotId !== query.lotId) {
        return false;
      }
      return true;
    });
  }

  async findCycleCountSessionById(id: string): Promise<CycleCountSessionContract | undefined> {
    return this.cycleCountSessions.get(id);
  }

  async saveCycleCountSession(session: CycleCountSessionContract): Promise<void> {
    this.cycleCountSessions.set(session.id, session);
  }

  async findPurchaseOrderInventoryLink(
    purchaseOrderId: string
  ): Promise<PurchaseOrderInventoryLinkContract | undefined> {
    return this.purchaseOrderLinks.get(purchaseOrderId);
  }

  async savePurchaseOrderInventoryLink(link: PurchaseOrderInventoryLinkContract): Promise<void> {
    this.purchaseOrderLinks.set(link.purchaseOrderId, link);
  }

  async appendLedgerEntry(entry: InventoryLedgerEntryContract): Promise<void> {
    this.ledgerEntries.push(entry);
  }

  async queryLedgerEntries(query: InventoryLedgerQuery): Promise<InventoryLedgerQueryResponse> {
    const filtered = this.ledgerEntries.filter((entry) => {
      if (query.partSkuId && entry.partSkuId !== query.partSkuId) {
        return false;
      }
      if (query.locationId && entry.locationId !== query.locationId) {
        return false;
      }
      if (query.binId && entry.binId !== query.binId) {
        return false;
      }
      if (query.lotId && entry.lotId !== query.lotId) {
        return false;
      }
      if (query.sourceDocumentId && entry.sourceDocument?.documentId !== query.sourceDocumentId) {
        return false;
      }
      if (query.correlationId && entry.correlationId !== query.correlationId) {
        return false;
      }
      if (query.movementTypes && query.movementTypes.length > 0) {
        if (!query.movementTypes.includes(entry.movementType)) {
          return false;
        }
      }
      if (query.effectiveFrom && entry.effectiveAt < query.effectiveFrom) {
        return false;
      }
      if (query.effectiveTo && entry.effectiveAt > query.effectiveTo) {
        return false;
      }
      return true;
    });

    const offset = this.parseCursor(query.cursor);
    const normalizedLimit = this.normalizeLedgerLimit(query.limit);
    const entries = filtered.slice(offset, offset + normalizedLimit);
    const nextOffset = offset + entries.length;
    return {
      entries,
      nextCursor: nextOffset < filtered.length ? String(nextOffset) : undefined
    };
  }

  async findVendorById(id: string): Promise<Vendor | undefined> {
    return this.vendors.get(id);
  }

  async findVendorByCode(vendorCode: string): Promise<Vendor | undefined> {
    return [...this.vendors.values()].find((vendor) => vendor.vendorCode === vendorCode);
  }

  async saveVendor(vendor: Vendor): Promise<void> {
    this.vendors.set(vendor.id, vendor);
  }

  async findPurchaseOrderById(id: string): Promise<PurchaseOrder | undefined> {
    return this.purchaseOrders.get(id);
  }

  async findPurchaseOrderByNumber(poNumber: string): Promise<PurchaseOrder | undefined> {
    return [...this.purchaseOrders.values()].find((po) => po.poNumber === poNumber);
  }

  async savePurchaseOrder(po: PurchaseOrder): Promise<void> {
    this.purchaseOrders.set(po.id, po);
  }

  private substitutionKey(partSkuId: string, substitutePartSkuId: string): string {
    return `${partSkuId}::${substitutePartSkuId}`;
  }

  private conversionKey(
    partSkuId: string | undefined,
    fromUnitCode: string,
    toUnitCode: string
  ): string {
    return `${partSkuId ?? '*'}::${this.normalizedCode(fromUnitCode)}::${this.normalizedCode(toUnitCode)}`;
  }

  private balanceKey(partSkuId: string, locationId: string, binId?: string, lotId?: string): string {
    return `${partSkuId}::${locationId}::${binId ?? '*'}::${lotId ?? '*'}`;
  }

  private normalizedCode(code: string): string {
    return code.trim().toUpperCase();
  }

  private parseCursor(cursor: string | undefined): number {
    if (cursor === undefined) {
      return 0;
    }
    const parsed = Number.parseInt(cursor, 10);
    if (!Number.isFinite(parsed) || parsed < 0) {
      return 0;
    }
    return parsed;
  }

  private normalizeLedgerLimit(limit: number | undefined): number {
    if (limit === undefined || !Number.isInteger(limit) || limit <= 0) {
      return 50;
    }
    return Math.min(limit, 250);
  }
}
