import { randomUUID } from 'node:crypto';
import {
  InvariantViolationError,
  PurchaseOrderDesign,
  PurchaseOrderState,
  type PurchaseOrder,
  type PurchaseOrderLine,
  type Vendor,
  VendorState,
  assertTransitionAllowed
} from '../../../../../packages/domain/src/model/index.js';
import { AUDIT_POINTS, type AuditSink } from '../../audit/index.js';
import type { DomainEventName } from '../../events/catalog.js';
import {
  type EventEnvelope,
  type EventPublisher,
  type OutboxWriter,
  publishWithOutbox
} from '../../events/index.js';
import type { ObservabilityContext, ObservabilityHooks } from '../../observability/hooks.js';
import type { InventoryRepository } from './inventory.repository.js';

export interface ProcurementServiceDeps {
  repository: InventoryRepository;
  audit: AuditSink;
  publisher: EventPublisher;
  outbox: OutboxWriter;
  observability: ObservabilityHooks;
}

export interface CommandContext extends Pick<ObservabilityContext, 'correlationId' | 'actorId'> {
  module: string;
}

export interface CreateVendorInput {
  vendorCode: string;
  name: string;
  email?: string;
  phone?: string;
  leadTimeDays?: number;
}

export interface CreatePurchaseOrderInput {
  poNumber: string;
  vendorId: string;
  lines: Array<{
    partSkuId: string;
    orderedQty: number;
    unitCost: number;
  }>;
  expectedAt?: string;
  notes?: string;
}

export class ProcurementService {
  constructor(private readonly deps: ProcurementServiceDeps) {}

  async createVendor(input: CreateVendorInput, context: CommandContext): Promise<Vendor> {
    if (!input.vendorCode.trim()) {
      throw new InvariantViolationError('vendorCode is required');
    }

    const existing = await this.deps.repository.findVendorByCode(input.vendorCode.trim());
    if (existing) {
      throw new InvariantViolationError(`Vendor code already exists: ${input.vendorCode}`);
    }

    const now = new Date().toISOString();
    const vendor: Vendor = {
      id: randomUUID(),
      vendorCode: input.vendorCode.trim(),
      state: VendorState.ACTIVE,
      name: input.name.trim(),
      email: input.email?.trim(),
      phone: input.phone?.trim(),
      leadTimeDays: input.leadTimeDays,
      createdAt: now,
      updatedAt: now
    };

    await this.deps.repository.saveVendor(vendor);
    await this.recordMutation(
      AUDIT_POINTS.purchaseOrderCreate,
      'Vendor',
      vendor.id,
      vendor,
      'vendor.created',
      context
    );
    return vendor;
  }

  async createPurchaseOrder(
    input: CreatePurchaseOrderInput,
    context: CommandContext
  ): Promise<PurchaseOrder> {
    if (!input.poNumber.trim()) {
      throw new InvariantViolationError('poNumber is required');
    }

    const existingPo = await this.deps.repository.findPurchaseOrderByNumber(input.poNumber.trim());
    if (existingPo) {
      throw new InvariantViolationError(`Purchase order number already exists: ${input.poNumber}`);
    }

    const vendor = await this.deps.repository.findVendorById(input.vendorId);
    if (!vendor || vendor.state !== VendorState.ACTIVE) {
      throw new InvariantViolationError('Vendor must exist and be ACTIVE');
    }

    const lines = this.buildLines(input.lines);
    const now = new Date().toISOString();
    const po: PurchaseOrder = {
      id: randomUUID(),
      poNumber: input.poNumber.trim(),
      vendorId: input.vendorId,
      state: PurchaseOrderState.DRAFT,
      orderedAt: now,
      expectedAt: input.expectedAt,
      notes: input.notes,
      lines,
      updatedAt: now
    };

    await this.deps.repository.savePurchaseOrder(po);
    await this.recordMutation(
      AUDIT_POINTS.purchaseOrderCreate,
      'PurchaseOrder',
      po.id,
      { poNumber: po.poNumber, lineCount: po.lines.length },
      'purchase_order.created',
      context
    );
    return po;
  }

  async transitionPurchaseOrder(
    purchaseOrderId: string,
    nextState: PurchaseOrderState,
    context: CommandContext
  ): Promise<PurchaseOrder> {
    const existing = await this.requirePurchaseOrder(purchaseOrderId);
    assertTransitionAllowed(existing.state, nextState, PurchaseOrderDesign.lifecycle);

    if (nextState === PurchaseOrderState.CANCELLED) {
      const receivedQty = existing.lines.reduce((sum, line) => sum + line.receivedQty, 0);
      if (receivedQty > 0) {
        throw new InvariantViolationError(
          'Cannot cancel purchase order after receiving inventory'
        );
      }
    }

    const updated: PurchaseOrder = {
      ...existing,
      state: nextState,
      updatedAt: new Date().toISOString()
    };
    await this.deps.repository.savePurchaseOrder(updated);

    const eventName = this.getTransitionEvent(nextState);
    await this.recordMutation(
      AUDIT_POINTS.purchaseOrderStateChange,
      'PurchaseOrder',
      updated.id,
      { before: existing.state, after: updated.state },
      eventName,
      context
    );
    return updated;
  }

  async receivePurchaseOrderLines(
    purchaseOrderId: string,
    received: Array<{ lineId: string; quantity: number }>,
    context: CommandContext
  ): Promise<PurchaseOrder> {
    const existing = await this.requirePurchaseOrder(purchaseOrderId);
    if (
      existing.state !== PurchaseOrderState.SENT &&
      existing.state !== PurchaseOrderState.PARTIALLY_RECEIVED
    ) {
      throw new InvariantViolationError(
        `Cannot receive lines while purchase order state is ${existing.state}`
      );
    }

    const quantityByLine = new Map(received.map((row) => [row.lineId, row.quantity]));
    const lines = existing.lines.map((line) => {
      const delta = quantityByLine.get(line.id) ?? 0;
      if (delta < 0) {
        throw new InvariantViolationError('Received quantity cannot be negative');
      }
      const nextQty = line.receivedQty + delta;
      if (nextQty > line.orderedQty) {
        throw new InvariantViolationError(
          `Line ${line.id} exceeds ordered quantity (${line.orderedQty})`
        );
      }
      return {
        ...line,
        receivedQty: nextQty
      };
    });

    const allReceived = lines.every((line) => line.receivedQty === line.orderedQty);
    const nextState = allReceived
      ? PurchaseOrderState.RECEIVED
      : PurchaseOrderState.PARTIALLY_RECEIVED;
    const updated: PurchaseOrder = {
      ...existing,
      lines,
      state: nextState,
      updatedAt: new Date().toISOString()
    };
    await this.deps.repository.savePurchaseOrder(updated);
    await this.recordMutation(
      AUDIT_POINTS.purchaseOrderStateChange,
      'PurchaseOrder',
      updated.id,
      { receivedLineCount: received.length, state: nextState },
      nextState === PurchaseOrderState.RECEIVED
        ? 'purchase_order.received'
        : 'purchase_order.partially_received',
      context
    );
    return updated;
  }

  private buildLines(
    inputLines: CreatePurchaseOrderInput['lines']
  ): PurchaseOrderLine[] {
    if (inputLines.length === 0) {
      throw new InvariantViolationError('Purchase order requires at least one line');
    }

    const seenPartIds = new Set<string>();
    return inputLines.map((line) => {
      if (line.orderedQty <= 0) {
        throw new InvariantViolationError('orderedQty must be > 0');
      }
      if (line.unitCost < 0) {
        throw new InvariantViolationError('unitCost must be >= 0');
      }
      if (seenPartIds.has(line.partSkuId)) {
        throw new InvariantViolationError(`Duplicate partSkuId in purchase order: ${line.partSkuId}`);
      }
      seenPartIds.add(line.partSkuId);
      return {
        id: randomUUID(),
        partSkuId: line.partSkuId,
        orderedQty: line.orderedQty,
        receivedQty: 0,
        unitCost: line.unitCost
      };
    });
  }

  private async requirePurchaseOrder(purchaseOrderId: string): Promise<PurchaseOrder> {
    const purchaseOrder = await this.deps.repository.findPurchaseOrderById(purchaseOrderId);
    if (!purchaseOrder) {
      throw new InvariantViolationError(`PurchaseOrder not found: ${purchaseOrderId}`);
    }
    return purchaseOrder;
  }

  private getTransitionEvent(nextState: PurchaseOrderState): DomainEventName {
    switch (nextState) {
      case PurchaseOrderState.APPROVED:
        return 'purchase_order.approved';
      case PurchaseOrderState.SENT:
        return 'purchase_order.sent';
      case PurchaseOrderState.CANCELLED:
        return 'purchase_order.cancelled';
      default:
        return 'purchase_order.created';
    }
  }

  private async recordMutation(
    action: string,
    entityType: string,
    entityId: string,
    metadata: unknown,
    eventName: DomainEventName,
    context: CommandContext
  ): Promise<void> {
    await this.deps.audit.record({
      actorId: context.actorId,
      action,
      entityType,
      entityId,
      correlationId: context.correlationId,
      metadata,
      createdAt: new Date().toISOString()
    });

    const event: EventEnvelope<unknown> = {
      name: eventName,
      correlationId: context.correlationId,
      emittedAt: new Date().toISOString(),
      payload: metadata
    };

    await publishWithOutbox(this.deps.publisher, this.deps.outbox, event);
    this.deps.observability.metric('purchase_order.transition', 1, context);
  }
}
