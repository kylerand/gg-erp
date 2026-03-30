/**
 * Customer sync service — manages the lifecycle of syncing GG customers
 * to QuickBooks Online.
 *
 * Follows the same state-machine pattern as InvoiceSyncService:
 *   PENDING → IN_PROGRESS → SYNCED | FAILED
 *                            PENDING → SKIPPED (customer already in QB)
 *
 * Depends on EntityMappingService for idempotent QB ID resolution.
 */
import { randomUUID } from 'node:crypto';
import {
  PrismaClient,
  CustomerSyncState as PrismaCustomerSyncState,
} from '@prisma/client';
import type { CustomerSyncRecord as PrismaCustomerSyncModel } from '@prisma/client';
import {
  assertTransitionAllowed,
  CustomerSyncRecordDesign,
  CustomerSyncState,
  InvariantViolationError,
  type CustomerSyncRecord,
} from '../../../../../packages/domain/src/model/index.js';
import { AUDIT_POINTS, type AuditSink } from '../../audit/index.js';
import {
  type EventEnvelope,
  type EventPublisher,
  type OutboxWriter,
  publishWithOutbox,
} from '../../events/index.js';
import type { ObservabilityContext, ObservabilityHooks } from '../../observability/hooks.js';
import type { EntityMappingService } from './entityMapping.service.js';
import { QuickBooksClient, type QbTokens } from './quickbooks.client.js';

export interface CustomerSyncCommandContext
  extends Pick<ObservabilityContext, 'correlationId' | 'actorId'> {
  module: string;
}

export interface CustomerSyncServiceDeps {
  audit: AuditSink;
  publisher: EventPublisher;
  outbox: OutboxWriter;
  observability: ObservabilityHooks;
  entityMapping: EntityMappingService;
  queries: CustomerSyncQueries;
}

export interface CustomerSyncInput {
  customerId: string;
  displayName: string;
  email?: string;
  integrationAccountId: string;
}

// ─── Prisma singleton ──────────────────────────────────────────────────────────

let customerSyncPrisma: PrismaClient | undefined;

function getCustomerSyncPrisma(): PrismaClient {
  customerSyncPrisma ??= new PrismaClient();
  return customerSyncPrisma;
}

// ─── Domain ↔ Prisma mapping ───────────────────────────────────────────────────

function toDomain(r: PrismaCustomerSyncModel): CustomerSyncRecord {
  return {
    id: r.id,
    customerId: r.customerId,
    provider: r.provider as CustomerSyncRecord['provider'],
    state: r.state as string as CustomerSyncState,
    attemptCount: r.attemptCount,
    lastErrorCode: r.lastErrorCode ?? undefined,
    lastErrorMessage: r.lastErrorMessage ?? undefined,
    externalReference: r.externalReference ?? undefined,
    syncedAt: r.syncedAt?.toISOString(),
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

// ─── Exported query object (mockable in tests) ─────────────────────────────────

export const customerSyncQueries = {
  async findById(id: string): Promise<CustomerSyncRecord | undefined> {
    const r = await getCustomerSyncPrisma().customerSyncRecord.findUnique({
      where: { id },
    });
    return r ? toDomain(r) : undefined;
  },

  async findByCustomerAndProvider(
    customerId: string,
    provider: string,
  ): Promise<CustomerSyncRecord | undefined> {
    const r = await getCustomerSyncPrisma().customerSyncRecord.findUnique({
      where: { customerId_provider: { customerId, provider } },
    });
    return r ? toDomain(r) : undefined;
  },

  async listByState(state: CustomerSyncState): Promise<CustomerSyncRecord[]> {
    const records = await getCustomerSyncPrisma().customerSyncRecord.findMany({
      where: { state: state as string as PrismaCustomerSyncState },
      orderBy: { createdAt: 'asc' },
    });
    return records.map(toDomain);
  },

  async save(record: CustomerSyncRecord, correlationId: string): Promise<void> {
    const data = {
      customerId: record.customerId,
      provider: record.provider,
      state: record.state as string as PrismaCustomerSyncState,
      attemptCount: record.attemptCount,
      lastErrorCode: record.lastErrorCode ?? null,
      lastErrorMessage: record.lastErrorMessage ?? null,
      externalReference: record.externalReference ?? null,
      syncedAt: record.syncedAt ? new Date(record.syncedAt) : null,
      correlationId,
      updatedAt: new Date(record.updatedAt),
    };

    await getCustomerSyncPrisma().customerSyncRecord.upsert({
      where: { id: record.id },
      create: { id: record.id, ...data, createdAt: new Date(record.createdAt) },
      update: data,
    });
  },
};

export type CustomerSyncQueries = typeof customerSyncQueries;

// ─── Service ────────────────────────────────────────────────────────────────────

export class CustomerSyncService {
  constructor(private readonly deps: CustomerSyncServiceDeps) {}

  /**
   * Queue a customer for sync to QB. Creates a PENDING record.
   * If a record already exists for this customer+provider, returns it.
   */
  async queueSync(
    input: CustomerSyncInput,
    context: CustomerSyncCommandContext,
  ): Promise<CustomerSyncRecord> {
    const existing = await this.deps.queries.findByCustomerAndProvider(
      input.customerId,
      'QUICKBOOKS',
    );
    if (existing && existing.state !== CustomerSyncState.FAILED) {
      return existing;
    }

    const now = new Date().toISOString();
    const record: CustomerSyncRecord = {
      id: randomUUID(),
      customerId: input.customerId,
      provider: 'QUICKBOOKS',
      state: CustomerSyncState.PENDING,
      attemptCount: 0,
      createdAt: now,
      updatedAt: now,
    };
    await this.deps.queries.save(record, context.correlationId);

    await this.emitEvent(
      record.id,
      { customerId: input.customerId },
      'customer_sync.started',
      context,
    );
    return record;
  }

  /**
   * Execute the actual sync to QuickBooks for a given record.
   * Resolves existing QB customer via display name; creates if not found.
   * Stores the entity mapping for future lookups.
   */
  async executeSync(
    recordId: string,
    input: CustomerSyncInput,
    tokens: QbTokens,
    context: CustomerSyncCommandContext,
  ): Promise<CustomerSyncRecord> {
    const record = await this.requireRecord(recordId);
    assertTransitionAllowed(
      record.state,
      CustomerSyncState.IN_PROGRESS,
      CustomerSyncRecordDesign.lifecycle,
    );

    const inProgress: CustomerSyncRecord = {
      ...record,
      state: CustomerSyncState.IN_PROGRESS,
      attemptCount: record.attemptCount + 1,
      updatedAt: new Date().toISOString(),
    };
    await this.deps.queries.save(inProgress, context.correlationId);

    const client = new QuickBooksClient(tokens);

    try {
      // Check if customer already exists in QB via entity mapping
      const existingExternalId = await this.deps.entityMapping.findExternalId(
        input.integrationAccountId,
        'Customer',
        input.customerId,
      );

      let qbCustomerId: string;

      if (existingExternalId) {
        // Already mapped — mark as skipped (already synced)
        qbCustomerId = existingExternalId;
      } else {
        // Try to find by display name in QB
        const found = await client.findCustomer(input.displayName);
        if (found) {
          qbCustomerId = found.id;
        } else {
          // Create in QB
          const created = await client.createCustomer(input.displayName, input.email);
          qbCustomerId = created.qbCustomerId;
        }

        // Store mapping
        await this.deps.entityMapping.upsertMapping(
          input.integrationAccountId,
          'Customer',
          input.customerId,
          qbCustomerId,
        );
      }

      const synced: CustomerSyncRecord = {
        ...inProgress,
        state: CustomerSyncState.SYNCED,
        externalReference: qbCustomerId,
        syncedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      await this.deps.queries.save(synced, context.correlationId);

      await this.emitEvent(
        recordId,
        { customerId: input.customerId, qbCustomerId },
        'customer_sync.succeeded',
        context,
      );

      return synced;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      const errorCode = errorMessage.startsWith('QB_')
        ? errorMessage.split(':')[0]
        : 'SYNC_ERROR';

      const failed: CustomerSyncRecord = {
        ...inProgress,
        state: CustomerSyncState.FAILED,
        lastErrorCode: errorCode,
        lastErrorMessage: errorMessage,
        updatedAt: new Date().toISOString(),
      };
      await this.deps.queries.save(failed, context.correlationId);

      await this.emitEvent(
        recordId,
        { customerId: input.customerId, errorCode, errorMessage },
        'customer_sync.failed',
        context,
      );

      return failed;
    }
  }

  async getRecord(recordId: string): Promise<CustomerSyncRecord | undefined> {
    return this.deps.queries.findById(recordId);
  }

  async listByState(state: CustomerSyncState): Promise<CustomerSyncRecord[]> {
    return this.deps.queries.listByState(state);
  }

  private async requireRecord(recordId: string): Promise<CustomerSyncRecord> {
    const record = await this.deps.queries.findById(recordId);
    if (!record) {
      throw new InvariantViolationError(`CustomerSyncRecord not found: ${recordId}`);
    }
    return record;
  }

  private async emitEvent(
    recordId: string,
    metadata: unknown,
    eventName:
      | 'customer_sync.started'
      | 'customer_sync.succeeded'
      | 'customer_sync.failed'
      | 'customer_sync.skipped',
    context: CustomerSyncCommandContext,
  ): Promise<void> {
    await this.deps.audit.record({
      actorId: context.actorId,
      action: AUDIT_POINTS.invoiceSyncStart, // TODO: add customer_sync audit points
      entityType: 'CustomerSyncRecord',
      entityId: recordId,
      correlationId: context.correlationId,
      metadata,
      createdAt: new Date().toISOString(),
    });

    const event: EventEnvelope<unknown> = {
      name: eventName,
      correlationId: context.correlationId,
      emittedAt: new Date().toISOString(),
      payload: metadata,
    };
    await publishWithOutbox(this.deps.publisher, this.deps.outbox, event);
    this.deps.observability.metric('customer_sync.transition', 1, context);
  }
}
