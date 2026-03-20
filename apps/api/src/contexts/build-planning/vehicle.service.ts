import { randomUUID } from 'node:crypto';
import {
  CartVehicleState,
  InvariantViolationError,
  type CartVehicle,
} from '../../../../../packages/domain/src/model/index.js';
import { generateVin } from '../../../../../packages/domain/src/vin/vin-generator.js';
import { AUDIT_POINTS, type AuditSink } from '../../audit/index.js';
import {
  type EventPublisher,
  type OutboxWriter,
  publishWithOutbox,
} from '../../events/publisher.js';
import type { ObservabilityContext, ObservabilityHooks } from '../../observability/hooks.js';
import { toVehicleRegisteredEvent } from './vehicle.contracts.js';
import type { VehicleRepository } from './vehicle.repository.js';

export interface VehicleServiceDeps {
  repository: VehicleRepository;
  audit: AuditSink;
  publisher: EventPublisher;
  outbox: OutboxWriter;
  observability: ObservabilityHooks;
}

export interface CommandContext extends Pick<ObservabilityContext, 'correlationId' | 'actorId'> {
  module: string;
}

export interface RegisterVehicleInput {
  customerId: string;
  serialNumber: string;
  modelCode: string;
  modelYear: number;
}

export class VehicleService {
  constructor(private readonly deps: VehicleServiceDeps) {}

  async registerVehicle(
    input: RegisterVehicleInput,
    context: CommandContext,
  ): Promise<CartVehicle> {
    if (!input.customerId?.trim()) {
      throw new InvariantViolationError('customerId is required');
    }
    if (!input.serialNumber?.trim()) {
      throw new InvariantViolationError('serialNumber is required');
    }
    if (!input.modelCode?.trim()) {
      throw new InvariantViolationError('modelCode is required');
    }
    if (!Number.isInteger(input.modelYear)) {
      throw new InvariantViolationError('modelYear must be an integer');
    }

    const existing = await this.deps.repository.findBySerialNumber(input.serialNumber);
    if (existing) {
      throw new InvariantViolationError(
        `A vehicle with serial number '${input.serialNumber}' already exists`,
      );
    }

    const sequenceNumber = await this.deps.repository.nextSequenceNumber();
    const vin = generateVin(input.modelYear, sequenceNumber);

    const vehicle: CartVehicle = {
      id: randomUUID(),
      vin,
      serialNumber: input.serialNumber.trim(),
      modelCode: input.modelCode.trim(),
      modelYear: input.modelYear,
      customerId: input.customerId.trim(),
      state: CartVehicleState.REGISTERED,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await this.deps.audit.record({
      actorId: context.actorId,
      action: AUDIT_POINTS.cartVehicleRegister,
      entityType: 'CartVehicle',
      entityId: vehicle.id,
      correlationId: context.correlationId,
      metadata: { vin: vehicle.vin, serialNumber: vehicle.serialNumber },
      createdAt: new Date().toISOString(),
    });

    const saved = await this.deps.repository.save(vehicle);

    const event = toVehicleRegisteredEvent(saved, context.correlationId);
    await publishWithOutbox(this.deps.publisher, this.deps.outbox, event);

    return saved;
  }
}
