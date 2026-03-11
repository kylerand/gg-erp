import { randomUUID } from 'node:crypto';
import {
  InvariantViolationError,
  PartSkuDesign,
  PartSkuState,
  type PartSku,
  assertTransitionAllowed
} from '../../../../../packages/domain/src/model/index.js';
import { AUDIT_POINTS } from '../../audit/index.js';
import {
  type ConfigurePartSubstitutionRequest,
  type CreateBinRequest,
  type CreateLocationRequest,
  type CreatePartSkuRequest,
  type InventoryBinContract,
  type InventoryLocationContract,
  type PartSubstitutionContract,
  type UnitOfMeasureContract,
  type UnitOfMeasureConversionContract,
  type UpdatePartSkuRequest,
  type UpsertUnitConversionRequest,
  type UpsertUnitOfMeasureRequest
} from './inventory.api.contracts.js';
import { INVENTORY_WORKFLOW_EVENT_NAMES } from './inventory.events.js';
import {
  type CommandContext,
  type InventoryServiceDeps,
  InventoryServiceSupport
} from './inventory.service.shared.js';

export class InventoryCatalogService {
  private readonly support: InventoryServiceSupport;

  constructor(private readonly deps: InventoryServiceDeps) {
    this.support = new InventoryServiceSupport(deps);
  }

  async createPartSku(input: CreatePartSkuRequest, context: CommandContext): Promise<PartSku> {
    return this.support.withObservedExecution('inventory.catalog.create_part_sku', context, async () => {
      if (!input.sku.trim()) {
        throw new InvariantViolationError('SKU is required');
      }
      if (!input.name.trim()) {
        throw new InvariantViolationError('Part name is required');
      }
      if (input.reorderPoint < 0) {
        throw new InvariantViolationError('reorderPoint must be non-negative');
      }

      const normalizedSku = input.sku.trim();
      const existing = await this.deps.repository.findPartSkuBySku(normalizedSku);
      if (existing) {
        throw new InvariantViolationError(`Part SKU already exists: ${normalizedSku}`);
      }

      const now = new Date().toISOString();
      const part: PartSku = {
        id: randomUUID(),
        sku: normalizedSku,
        state: PartSkuState.ACTIVE,
        name: input.name.trim(),
        description: input.description?.trim() || undefined,
        unitOfMeasure: input.unitOfMeasure,
        reorderPoint: input.reorderPoint,
        createdAt: now,
        updatedAt: now
      };
      await this.deps.repository.savePartSku(part);
      await this.support.recordMutation(
        {
          action: AUDIT_POINTS.inventoryPartCatalogChange,
          entityType: 'PartSku',
          entityId: part.id,
          metadata: part,
          eventName: INVENTORY_WORKFLOW_EVENT_NAMES.partSkuCreated,
          successMetricName: 'inventory.catalog.part_sku.created'
        },
        context
      );
      return part;
    });
  }

  async updatePartSku(input: UpdatePartSkuRequest, context: CommandContext): Promise<PartSku> {
    return this.support.withObservedExecution('inventory.catalog.update_part_sku', context, async () => {
      const existing = await this.deps.repository.findPartSkuById(input.partSkuId);
      if (!existing) {
        throw new InvariantViolationError(`Part SKU not found: ${input.partSkuId}`);
      }

      const changedFields: string[] = [];
      const updated: PartSku = { ...existing };

      if (input.name !== undefined) {
        const name = input.name.trim();
        if (!name) {
          throw new InvariantViolationError('Part name cannot be empty');
        }
        if (name !== existing.name) {
          changedFields.push('name');
          updated.name = name;
        }
      }

      if (input.description !== undefined) {
        const description = input.description.trim() || undefined;
        if (description !== existing.description) {
          changedFields.push('description');
          updated.description = description;
        }
      }

      if (input.reorderPoint !== undefined) {
        if (input.reorderPoint < 0) {
          throw new InvariantViolationError('reorderPoint must be non-negative');
        }
        if (input.reorderPoint !== existing.reorderPoint) {
          changedFields.push('reorderPoint');
          updated.reorderPoint = input.reorderPoint;
        }
      }

      if (input.state !== undefined && input.state !== existing.state) {
        assertTransitionAllowed(existing.state, input.state, PartSkuDesign.lifecycle);
        changedFields.push('state');
        updated.state = input.state;
      }

      updated.updatedAt = new Date().toISOString();
      await this.deps.repository.savePartSku(updated);
      await this.support.recordMutation(
        {
          action: AUDIT_POINTS.inventoryPartCatalogChange,
          entityType: 'PartSku',
          entityId: updated.id,
          metadata: { partSkuId: updated.id, changedFields, state: updated.state },
          eventName: INVENTORY_WORKFLOW_EVENT_NAMES.partSkuUpdated,
          successMetricName: 'inventory.catalog.part_sku.updated'
        },
        context
      );
      return updated;
    });
  }

  async configurePartSubstitution(
    input: ConfigurePartSubstitutionRequest,
    context: CommandContext
  ): Promise<PartSubstitutionContract> {
    return this.support.withObservedExecution(
      'inventory.catalog.configure_part_substitution',
      context,
      async () => {
        if (!input.partSkuId.trim() || !input.substitutePartSkuId.trim()) {
          throw new InvariantViolationError('partSkuId and substitutePartSkuId are required');
        }
        if (input.partSkuId === input.substitutePartSkuId) {
          throw new InvariantViolationError('partSkuId and substitutePartSkuId must differ');
        }
        if (!Number.isInteger(input.priority) || input.priority <= 0) {
          throw new InvariantViolationError('priority must be a positive integer');
        }

        const primary = await this.deps.repository.findPartSkuById(input.partSkuId);
        const substitute = await this.deps.repository.findPartSkuById(input.substitutePartSkuId);
        if (!primary || !substitute) {
          throw new InvariantViolationError('Both partSkuId and substitutePartSkuId must exist');
        }

        const existing = await this.deps.repository.findPartSubstitution(
          input.partSkuId,
          input.substitutePartSkuId
        );
        const now = new Date().toISOString();
        const substitution: PartSubstitutionContract = {
          id: existing?.id ?? randomUUID(),
          partSkuId: input.partSkuId,
          substitutePartSkuId: input.substitutePartSkuId,
          priority: input.priority,
          reasonCode: input.reasonCode?.trim() || undefined,
          effectiveFrom: input.effectiveFrom,
          effectiveTo: input.effectiveTo,
          state: 'ACTIVE',
          createdAt: existing?.createdAt ?? now,
          updatedAt: now
        };
        await this.deps.repository.savePartSubstitution(substitution);
        await this.support.recordMutation(
          {
            action: AUDIT_POINTS.inventoryPartCatalogChange,
            entityType: 'PartSubstitution',
            entityId: substitution.id,
            metadata: substitution,
            eventName: INVENTORY_WORKFLOW_EVENT_NAMES.partSubstitutionConfigured,
            successMetricName: 'inventory.catalog.part_substitution.configured'
          },
          context
        );
        return substitution;
      }
    );
  }

  async listPartSubstitutions(
    partSkuId: string,
    context: CommandContext
  ): Promise<PartSubstitutionContract[]> {
    return this.support.withObservedExecution(
      'inventory.catalog.list_part_substitutions',
      context,
      async () => {
        const part = await this.deps.repository.findPartSkuById(partSkuId);
        if (!part) {
          throw new InvariantViolationError(`Part SKU not found: ${partSkuId}`);
        }
        return this.deps.repository.listPartSubstitutions(partSkuId);
      }
    );
  }

  async upsertUnitOfMeasure(
    input: UpsertUnitOfMeasureRequest,
    context: CommandContext
  ): Promise<UnitOfMeasureContract> {
    return this.support.withObservedExecution('inventory.catalog.upsert_uom', context, async () => {
      if (!input.code.trim()) {
        throw new InvariantViolationError('code is required');
      }
      if (!input.name.trim()) {
        throw new InvariantViolationError('name is required');
      }
      if (!Number.isInteger(input.precisionScale) || input.precisionScale < 0) {
        throw new InvariantViolationError('precisionScale must be an integer >= 0');
      }

      const normalizedCode = input.code.trim().toUpperCase();
      const existing = await this.deps.repository.findUnitOfMeasureByCode(normalizedCode);
      const now = new Date().toISOString();
      const unit: UnitOfMeasureContract = {
        code: normalizedCode,
        name: input.name.trim(),
        precisionScale: input.precisionScale,
        state: input.state ?? existing?.state ?? 'ACTIVE',
        createdAt: existing?.createdAt ?? now,
        updatedAt: now
      };
      await this.deps.repository.saveUnitOfMeasure(unit);
      await this.support.recordMutation(
        {
          action: AUDIT_POINTS.inventoryPartCatalogChange,
          entityType: 'UnitOfMeasure',
          entityId: unit.code,
          metadata: unit,
          eventName: INVENTORY_WORKFLOW_EVENT_NAMES.partSkuUpdated,
          successMetricName: 'inventory.catalog.uom.upserted'
        },
        context
      );
      return unit;
    });
  }

  async upsertUnitConversion(
    input: UpsertUnitConversionRequest,
    context: CommandContext
  ): Promise<UnitOfMeasureConversionContract> {
    return this.support.withObservedExecution(
      'inventory.catalog.upsert_uom_conversion',
      context,
      async () => {
        const fromUnitCode = input.fromUnitCode.trim().toUpperCase();
        const toUnitCode = input.toUnitCode.trim().toUpperCase();
        if (!fromUnitCode || !toUnitCode) {
          throw new InvariantViolationError('fromUnitCode and toUnitCode are required');
        }
        if (fromUnitCode === toUnitCode) {
          throw new InvariantViolationError('fromUnitCode and toUnitCode must differ');
        }
        if (!Number.isFinite(input.factor) || input.factor <= 0) {
          throw new InvariantViolationError('factor must be > 0');
        }

        const fromUnit = await this.deps.repository.findUnitOfMeasureByCode(fromUnitCode);
        const toUnit = await this.deps.repository.findUnitOfMeasureByCode(toUnitCode);
        if (!fromUnit || !toUnit) {
          throw new InvariantViolationError('Both fromUnitCode and toUnitCode must exist before conversion');
        }
        if (input.partSkuId) {
          const part = await this.deps.repository.findPartSkuById(input.partSkuId);
          if (!part) {
            throw new InvariantViolationError(`Part SKU not found: ${input.partSkuId}`);
          }
        }

        const existing = await this.deps.repository.findUnitConversion(
          input.partSkuId,
          fromUnitCode,
          toUnitCode
        );
        const now = new Date().toISOString();
        const conversion: UnitOfMeasureConversionContract = {
          id: existing?.id ?? randomUUID(),
          partSkuId: input.partSkuId,
          fromUnitCode,
          toUnitCode,
          factor: input.factor,
          roundingMode: input.roundingMode,
          state: input.state ?? existing?.state ?? 'ACTIVE',
          createdAt: existing?.createdAt ?? now,
          updatedAt: now
        };
        await this.deps.repository.saveUnitConversion(conversion);
        await this.support.recordMutation(
          {
            action: AUDIT_POINTS.inventoryPartCatalogChange,
            entityType: 'UnitOfMeasureConversion',
            entityId: conversion.id,
            metadata: conversion,
            eventName: INVENTORY_WORKFLOW_EVENT_NAMES.uomConversionApplied,
            successMetricName: 'inventory.catalog.uom_conversion.upserted'
          },
          context
        );
        return conversion;
      }
    );
  }

  async createLocation(
    input: CreateLocationRequest,
    context: CommandContext
  ): Promise<InventoryLocationContract> {
    return this.support.withObservedExecution('inventory.catalog.create_location', context, async () => {
      if (!input.code.trim() || !input.name.trim() || !input.zone.trim()) {
        throw new InvariantViolationError('code, name, and zone are required');
      }

      const existing = await this.deps.repository.findLocationByCode(input.code.trim());
      if (existing) {
        throw new InvariantViolationError(`Location code already exists: ${input.code.trim()}`);
      }

      const now = new Date().toISOString();
      const location: InventoryLocationContract = {
        id: randomUUID(),
        code: input.code.trim().toUpperCase(),
        name: input.name.trim(),
        zone: input.zone.trim(),
        locationType: input.locationType,
        isPickable: input.isPickable ?? true,
        state: 'ACTIVE',
        createdAt: now,
        updatedAt: now
      };
      await this.deps.repository.saveLocation(location);
      await this.support.recordMutation(
        {
          action: AUDIT_POINTS.inventoryPartCatalogChange,
          entityType: 'InventoryLocation',
          entityId: location.id,
          metadata: location,
          eventName: 'inventory.location.created',
          successMetricName: 'inventory.catalog.location.created'
        },
        context
      );
      return location;
    });
  }

  async createBin(input: CreateBinRequest, context: CommandContext): Promise<InventoryBinContract> {
    return this.support.withObservedExecution('inventory.catalog.create_bin', context, async () => {
      if (!input.locationId.trim()) {
        throw new InvariantViolationError('locationId is required');
      }
      if (!input.code.trim()) {
        throw new InvariantViolationError('code is required');
      }

      const location = await this.deps.repository.findLocationById(input.locationId);
      if (!location) {
        throw new InvariantViolationError(`Location not found: ${input.locationId}`);
      }
      if (location.state !== 'ACTIVE') {
        throw new InvariantViolationError(`Location ${input.locationId} is not ACTIVE`);
      }

      const existing = await this.deps.repository.findBinByCode(input.locationId, input.code);
      if (existing) {
        throw new InvariantViolationError(
          `Bin code already exists in location ${input.locationId}: ${input.code}`
        );
      }

      const now = new Date().toISOString();
      const bin: InventoryBinContract = {
        id: randomUUID(),
        locationId: input.locationId,
        code: input.code.trim().toUpperCase(),
        state: input.state ?? 'OPEN',
        capacityUnits: input.capacityUnits,
        createdAt: now,
        updatedAt: now
      };
      await this.deps.repository.saveBin(bin);
      await this.support.recordMutation(
        {
          action: AUDIT_POINTS.inventoryPartCatalogChange,
          entityType: 'InventoryBin',
          entityId: bin.id,
          metadata: bin,
          eventName: 'inventory.bin.created',
          successMetricName: 'inventory.catalog.bin.created'
        },
        context
      );
      return bin;
    });
  }
}
