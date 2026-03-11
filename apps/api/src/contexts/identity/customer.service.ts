import { randomUUID } from 'node:crypto';
import {
  type Customer,
  CustomerDesign,
  CustomerLifecycleState,
  InvariantViolationError,
  assertTransitionAllowed
} from '../../../../../packages/domain/src/model/index.js';
import type { AuditSink } from '../../audit/index.js';
import {
  type EventEnvelope,
  type EventPublisher,
  type OutboxWriter,
  publishWithOutbox
} from '../../events/publisher.js';
import type { DomainEventName } from '../../events/catalog.js';
import type { ObservabilityContext, ObservabilityHooks } from '../../observability/hooks.js';
import { AUDIT_POINTS } from '../../audit/index.js';

export interface CustomerServiceDeps {
  audit: AuditSink;
  publisher: EventPublisher;
  outbox: OutboxWriter;
  observability: ObservabilityHooks;
}

export interface CommandContext extends Pick<ObservabilityContext, 'correlationId' | 'actorId'> {
  module: string;
}

export interface CreateCustomerInput {
  fullName: string;
  email: string;
  companyName?: string;
  phone?: string;
  preferredContactMethod?: 'EMAIL' | 'PHONE' | 'SMS';
}

export class CustomerService {
  private readonly customers = new Map<string, Customer>();

  constructor(private readonly deps: CustomerServiceDeps) {}

  async createCustomer(input: CreateCustomerInput, context: CommandContext): Promise<Customer> {
    this.deps.observability.trace('customer.create', context);

    if (!input.fullName.trim()) {
      throw new InvariantViolationError('Customer fullName is required');
    }

    const normalizedEmail = input.email.trim().toLowerCase();
    if (!normalizedEmail) {
      throw new InvariantViolationError('Customer email is required');
    }

    const duplicate = [...this.customers.values()].find(
      (customer) =>
        customer.email === normalizedEmail &&
        customer.state !== CustomerLifecycleState.ARCHIVED
    );
    if (duplicate) {
      throw new InvariantViolationError(`Customer email already exists: ${normalizedEmail}`);
    }

    const now = new Date().toISOString();
    const customer: Customer = {
      id: randomUUID(),
      state: CustomerLifecycleState.LEAD,
      fullName: input.fullName.trim(),
      companyName: input.companyName?.trim(),
      email: normalizedEmail,
      phone: input.phone?.trim(),
      preferredContactMethod: input.preferredContactMethod ?? 'EMAIL',
      createdAt: now,
      updatedAt: now
    };

    this.customers.set(customer.id, customer);
    await this.recordMutation(
      AUDIT_POINTS.customerCreate,
      customer.id,
      customer,
      'customer.created',
      context
    );
    return customer;
  }

  async transitionState(
    customerId: string,
    nextState: CustomerLifecycleState,
    context: CommandContext
  ): Promise<Customer> {
    const existing = this.customers.get(customerId);
    if (!existing) {
      throw new InvariantViolationError(`Customer not found: ${customerId}`);
    }

    assertTransitionAllowed(existing.state, nextState, CustomerDesign.lifecycle);
    const updated: Customer = {
      ...existing,
      state: nextState,
      updatedAt: new Date().toISOString(),
      archivedAt:
        nextState === CustomerLifecycleState.ARCHIVED
          ? new Date().toISOString()
          : existing.archivedAt
    };
    this.customers.set(customerId, updated);

    await this.recordMutation(
      AUDIT_POINTS.customerStateChange,
      customerId,
      { before: existing.state, after: updated.state },
      'customer.state_changed',
      context
    );

    return updated;
  }

  getCustomer(customerId: string): Customer | undefined {
    return this.customers.get(customerId);
  }

  private async recordMutation(
    action: string,
    entityId: string,
    metadata: unknown,
    eventName: DomainEventName,
    context: CommandContext
  ): Promise<void> {
    await this.deps.audit.record({
      actorId: context.actorId,
      action,
      entityType: 'Customer',
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
    this.deps.observability.metric('customer.mutation', 1, context);
  }
}
