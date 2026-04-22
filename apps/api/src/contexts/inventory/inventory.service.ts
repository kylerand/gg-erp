import type {
  InventoryLot,
  PartSku
} from '../../../../../packages/domain/src/model/inventory.js';
import type {
  AllocateInventoryRequest,
  ConfigurePartSubstitutionRequest,
  ConsumeWorkOrderMaterialRequest,
  CreateBinRequest,
  CreateLocationRequest,
  CreateManufacturerRequest,
  CreatePartSkuRequest,
  CycleCountReconciliationContract,
  CycleCountSessionContract,
  InventoryAdjustmentContract,
  InventoryAllocationContract,
  InventoryBalanceQuery,
  InventoryBalanceRecord,
  InventoryBinContract,
  InventoryLedgerQuery,
  InventoryLedgerQueryResponse,
  InventoryLocationContract,
  InventoryTransferContract,
  LinkReceiptToPurchaseOrderRequest,
  ListManufacturersRequest,
  ListPartSkusRequest,
  ListPartSkusResponse,
  ManufacturerContract,
  PartChainResponse,
  PartSubstitutionContract,
  PurchaseOrderInventoryLinkContract,
  ReceiveLotRequest,
  ReconcileCycleCountRequest,
  RecordInventoryAdjustmentRequest,
  RecordInventoryTransferRequest,
  ReleaseInventoryRequest,
  ReserveInventoryRequest,
  StageMaterialPlanResponse,
  StartCycleCountSessionRequest,
  UnitOfMeasureContract,
  UnitOfMeasureConversionContract,
  UpdateManufacturerRequest,
  UpdatePartSkuRequest,
  UpsertUnitConversionRequest,
  UpsertUnitOfMeasureRequest,
  WorkOrderConsumptionContract,
  WorkOrderMaterialStatusContract
} from './inventory.api.contracts.js';
import { InventoryCatalogService } from './inventory.catalog.service.js';
import { InventoryCycleCountService } from './inventory.cycle-count.service.js';
import { InventoryQueryService } from './inventory.query.service.js';
import { InventoryStockMovementService } from './inventory.stock-movement.service.js';
import type { ReserveInventoryResult } from './inventory.stock-movement.service.js';
import type { CommandContext, InventoryServiceDeps } from './inventory.service.shared.js';

export type { CommandContext, InventoryServiceDeps };
export type CreatePartSkuInput = CreatePartSkuRequest;
export type ReceiveLotInput = ReceiveLotRequest;

export class InventoryService {
  private readonly catalogService: InventoryCatalogService;
  private readonly stockMovementService: InventoryStockMovementService;
  private readonly cycleCountService: InventoryCycleCountService;
  private readonly queryService: InventoryQueryService;

  constructor(deps: InventoryServiceDeps) {
    this.catalogService = new InventoryCatalogService(deps);
    this.stockMovementService = new InventoryStockMovementService(deps);
    this.cycleCountService = new InventoryCycleCountService(deps, this.stockMovementService);
    this.queryService = new InventoryQueryService(deps);
  }

  async createPartSku(input: CreatePartSkuInput, context: CommandContext): Promise<PartSku> {
    return this.catalogService.createPartSku(input, context);
  }

  async updatePartSku(input: UpdatePartSkuRequest, context: CommandContext): Promise<PartSku> {
    return this.catalogService.updatePartSku(input, context);
  }

  async listPartSkus(
    query: ListPartSkusRequest,
    context: CommandContext
  ): Promise<ListPartSkusResponse> {
    return this.catalogService.listPartSkus(query, context);
  }

  async getPartSku(partSkuId: string, context: CommandContext): Promise<PartSku> {
    return this.catalogService.getPartSku(partSkuId, context);
  }

  async getPartChain(partSkuId: string, context: CommandContext): Promise<PartChainResponse> {
    return this.queryService.getPartChain(partSkuId, context);
  }

  async planMaterialByStage(context: CommandContext): Promise<StageMaterialPlanResponse> {
    return this.queryService.planMaterialByStage(context);
  }

  async createManufacturer(
    input: CreateManufacturerRequest,
    context: CommandContext
  ): Promise<ManufacturerContract> {
    return this.catalogService.createManufacturer(input, context);
  }

  async updateManufacturer(
    input: UpdateManufacturerRequest,
    context: CommandContext
  ): Promise<ManufacturerContract> {
    return this.catalogService.updateManufacturer(input, context);
  }

  async listManufacturers(
    query: ListManufacturersRequest,
    context: CommandContext
  ): Promise<ManufacturerContract[]> {
    return this.catalogService.listManufacturers(query, context);
  }

  async configurePartSubstitution(
    input: ConfigurePartSubstitutionRequest,
    context: CommandContext
  ): Promise<PartSubstitutionContract> {
    return this.catalogService.configurePartSubstitution(input, context);
  }

  async listPartSubstitutions(
    partSkuId: string,
    context: CommandContext
  ): Promise<PartSubstitutionContract[]> {
    return this.catalogService.listPartSubstitutions(partSkuId, context);
  }

  async upsertUnitOfMeasure(
    input: UpsertUnitOfMeasureRequest,
    context: CommandContext
  ): Promise<UnitOfMeasureContract> {
    return this.catalogService.upsertUnitOfMeasure(input, context);
  }

  async upsertUnitConversion(
    input: UpsertUnitConversionRequest,
    context: CommandContext
  ): Promise<UnitOfMeasureConversionContract> {
    return this.catalogService.upsertUnitConversion(input, context);
  }

  async createLocation(
    input: CreateLocationRequest,
    context: CommandContext
  ): Promise<InventoryLocationContract> {
    return this.catalogService.createLocation(input, context);
  }

  async createBin(input: CreateBinRequest, context: CommandContext): Promise<InventoryBinContract> {
    return this.catalogService.createBin(input, context);
  }

  async receiveLot(input: ReceiveLotInput, context: CommandContext): Promise<InventoryLot> {
    return this.stockMovementService.receiveLot(input, context);
  }

  async reserveInventory(
    input: ReserveInventoryRequest,
    context: CommandContext
  ): Promise<ReserveInventoryResult> {
    return this.stockMovementService.reserveInventory(input, context);
  }

  async reserveLotQuantity(
    lotId: string,
    quantity: number,
    context: CommandContext
  ): Promise<InventoryLot> {
    return this.stockMovementService.reserveLotQuantity(lotId, quantity, context);
  }

  async allocateReservation(
    input: AllocateInventoryRequest,
    context: CommandContext
  ): Promise<InventoryAllocationContract> {
    return this.stockMovementService.allocateReservation(input, context);
  }

  async releaseInventory(
    input: ReleaseInventoryRequest,
    context: CommandContext
  ): Promise<InventoryLot> {
    return this.stockMovementService.releaseLotReservation(
      input.lotId,
      input.quantity,
      context,
      input.reasonCode
    );
  }

  async releaseLotReservation(
    lotId: string,
    quantity: number,
    context: CommandContext
  ): Promise<InventoryLot> {
    return this.stockMovementService.releaseLotReservation(lotId, quantity, context);
  }

  async consumeReservedQuantity(
    lotId: string,
    quantity: number,
    context: CommandContext
  ): Promise<InventoryLot> {
    return this.stockMovementService.consumeReservedQuantity(lotId, quantity, context);
  }

  async consumeWorkOrderMaterial(
    input: ConsumeWorkOrderMaterialRequest,
    context: CommandContext
  ): Promise<WorkOrderConsumptionContract> {
    return this.stockMovementService.consumeWorkOrderMaterial(input, context);
  }

  async recordAdjustment(
    input: RecordInventoryAdjustmentRequest,
    context: CommandContext
  ): Promise<InventoryAdjustmentContract> {
    return this.stockMovementService.recordAdjustment(input, context);
  }

  async recordTransfer(
    input: RecordInventoryTransferRequest,
    context: CommandContext
  ): Promise<InventoryTransferContract> {
    return this.stockMovementService.recordTransfer(input, context);
  }

  async startCycleCount(
    input: StartCycleCountSessionRequest,
    context: CommandContext
  ): Promise<CycleCountSessionContract> {
    return this.cycleCountService.startCycleCount(input, context);
  }

  async reconcileCycleCount(
    input: ReconcileCycleCountRequest,
    context: CommandContext
  ): Promise<CycleCountReconciliationContract> {
    return this.cycleCountService.reconcileCycleCount(input, context);
  }

  async linkReceiptToPurchaseOrder(
    input: LinkReceiptToPurchaseOrderRequest,
    context: CommandContext
  ): Promise<PurchaseOrderInventoryLinkContract> {
    return this.stockMovementService.linkReceiptToPurchaseOrder(input, context);
  }

  async getBalances(
    query: InventoryBalanceQuery,
    context: CommandContext
  ): Promise<InventoryBalanceRecord[]> {
    return this.queryService.getBalances(query, context);
  }

  async getWorkOrderMaterialStatus(
    workOrderId: string,
    context: CommandContext
  ): Promise<WorkOrderMaterialStatusContract> {
    return this.queryService.getWorkOrderMaterialStatus(workOrderId, context);
  }

  async getPurchaseOrderReceiptStatus(
    purchaseOrderId: string,
    context: CommandContext
  ): Promise<PurchaseOrderInventoryLinkContract> {
    return this.queryService.getPurchaseOrderReceiptStatus(purchaseOrderId, context);
  }

  async queryLedger(
    query: InventoryLedgerQuery,
    context: CommandContext
  ): Promise<InventoryLedgerQueryResponse> {
    return this.queryService.queryLedger(query, context);
  }
}
