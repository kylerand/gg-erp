import { randomUUID } from 'node:crypto';
import {
  InvariantViolationError,
  LifecycleLevel,
  type Manufacturer,
  ManufacturerDesign,
  ManufacturerState,
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
  type CreateManufacturerRequest,
  type CreatePartSkuRequest,
  type InventoryBinContract,
  type InventoryLocationContract,
  type ListManufacturersRequest,
  type ListPartSkusRequest,
  type ListPartSkusResponse,
  type ManufacturerContract,
  type PartSubstitutionContract,
  type UnitOfMeasureContract,
  type UnitOfMeasureConversionContract,
  type UpdateManufacturerRequest,
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

      const lifecycleLevel = input.lifecycleLevel ?? LifecycleLevel.RAW_COMPONENT;
      await this.assertLifecycleChain(lifecycleLevel, input.producedFromPartId, input.producedViaStage);

      if (input.manufacturerId) {
        const manufacturer = await this.deps.repository.findManufacturerById(input.manufacturerId);
        if (!manufacturer) {
          throw new InvariantViolationError(`Manufacturer not found: ${input.manufacturerId}`);
        }
        if (manufacturer.state === ManufacturerState.INACTIVE) {
          throw new InvariantViolationError('Cannot assign an INACTIVE manufacturer to a new part');
        }
      }

      const now = new Date().toISOString();
      const part: PartSku = {
        id: randomUUID(),
        sku: normalizedSku,
        state: PartSkuState.ACTIVE,
        name: input.name.trim(),
        description: input.description?.trim() || undefined,
        variant: input.variant?.trim() || undefined,
        color: input.color,
        category: input.category,
        lifecycleLevel,
        installStage: input.installStage,
        manufacturerId: input.manufacturerId,
        manufacturerPartNumber: input.manufacturerPartNumber?.trim() || undefined,
        defaultVendorId: input.defaultVendorId,
        defaultLocationId: input.defaultLocationId,
        producedFromPartId: input.producedFromPartId,
        producedViaStage: input.producedViaStage,
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

      if (input.variant !== undefined) {
        const variant = input.variant === null ? undefined : input.variant.trim() || undefined;
        if (variant !== existing.variant) {
          changedFields.push('variant');
          updated.variant = variant;
        }
      }

      if (input.color !== undefined) {
        const color = input.color === null ? undefined : input.color;
        if (color !== existing.color) {
          changedFields.push('color');
          updated.color = color;
        }
      }

      if (input.category !== undefined) {
        const category = input.category === null ? undefined : input.category;
        if (category !== existing.category) {
          changedFields.push('category');
          updated.category = category;
        }
      }

      if (input.installStage !== undefined) {
        const installStage = input.installStage === null ? undefined : input.installStage;
        if (installStage !== existing.installStage) {
          changedFields.push('installStage');
          updated.installStage = installStage;
        }
      }

      if (input.manufacturerId !== undefined) {
        const manufacturerId = input.manufacturerId === null ? undefined : input.manufacturerId;
        if (manufacturerId && manufacturerId !== existing.manufacturerId) {
          const manufacturer = await this.deps.repository.findManufacturerById(manufacturerId);
          if (!manufacturer) {
            throw new InvariantViolationError(`Manufacturer not found: ${manufacturerId}`);
          }
        }
        if (manufacturerId !== existing.manufacturerId) {
          changedFields.push('manufacturerId');
          updated.manufacturerId = manufacturerId;
        }
      }

      if (input.manufacturerPartNumber !== undefined) {
        const mfrPart =
          input.manufacturerPartNumber === null
            ? undefined
            : input.manufacturerPartNumber.trim() || undefined;
        if (mfrPart !== existing.manufacturerPartNumber) {
          changedFields.push('manufacturerPartNumber');
          updated.manufacturerPartNumber = mfrPart;
        }
      }

      if (input.defaultVendorId !== undefined) {
        const defaultVendorId = input.defaultVendorId === null ? undefined : input.defaultVendorId;
        if (defaultVendorId !== existing.defaultVendorId) {
          changedFields.push('defaultVendorId');
          updated.defaultVendorId = defaultVendorId;
        }
      }

      if (input.defaultLocationId !== undefined) {
        const defaultLocationId =
          input.defaultLocationId === null ? undefined : input.defaultLocationId;
        if (defaultLocationId !== existing.defaultLocationId) {
          changedFields.push('defaultLocationId');
          updated.defaultLocationId = defaultLocationId;
        }
      }

      if (input.lifecycleLevel !== undefined && input.lifecycleLevel !== existing.lifecycleLevel) {
        changedFields.push('lifecycleLevel');
        updated.lifecycleLevel = input.lifecycleLevel;
      }

      if (input.producedFromPartId !== undefined) {
        const producedFromPartId =
          input.producedFromPartId === null ? undefined : input.producedFromPartId;
        if (producedFromPartId !== existing.producedFromPartId) {
          changedFields.push('producedFromPartId');
          updated.producedFromPartId = producedFromPartId;
        }
      }

      if (input.producedViaStage !== undefined) {
        const producedViaStage =
          input.producedViaStage === null ? undefined : input.producedViaStage;
        if (producedViaStage !== existing.producedViaStage) {
          changedFields.push('producedViaStage');
          updated.producedViaStage = producedViaStage;
        }
      }

      await this.assertLifecycleChain(
        updated.lifecycleLevel,
        updated.producedFromPartId,
        updated.producedViaStage,
        updated.id
      );

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

  async listPartSkus(
    query: ListPartSkusRequest,
    context: CommandContext
  ): Promise<ListPartSkusResponse> {
    return this.support.withObservedExecution('inventory.catalog.list_part_skus', context, async () => {
      return this.deps.repository.listPartSkus(query);
    });
  }

  async getPartSku(partSkuId: string, context: CommandContext): Promise<PartSku> {
    return this.support.withObservedExecution('inventory.catalog.get_part_sku', context, async () => {
      const part = await this.deps.repository.findPartSkuById(partSkuId);
      if (!part) {
        throw new InvariantViolationError(`Part SKU not found: ${partSkuId}`);
      }
      return part;
    });
  }

  async createManufacturer(
    input: CreateManufacturerRequest,
    context: CommandContext
  ): Promise<ManufacturerContract> {
    return this.support.withObservedExecution(
      'inventory.catalog.create_manufacturer',
      context,
      async () => {
        if (!input.manufacturerCode.trim()) {
          throw new InvariantViolationError('manufacturerCode is required');
        }
        if (!input.name.trim()) {
          throw new InvariantViolationError('Manufacturer name is required');
        }

        const code = input.manufacturerCode.trim();
        const existingByCode = await this.deps.repository.findManufacturerByCode(code);
        if (existingByCode) {
          throw new InvariantViolationError(`Manufacturer code already exists: ${code}`);
        }
        const existingByName = await this.deps.repository.findManufacturerByName(input.name.trim());
        if (existingByName) {
          throw new InvariantViolationError(`Manufacturer name already exists: ${input.name.trim()}`);
        }

        const now = new Date().toISOString();
        const manufacturer: Manufacturer = {
          id: randomUUID(),
          manufacturerCode: code,
          name: input.name.trim(),
          state: input.state ?? ManufacturerState.ACTIVE,
          website: input.website?.trim() || undefined,
          notes: input.notes?.trim() || undefined,
          createdAt: now,
          updatedAt: now
        };
        await this.deps.repository.saveManufacturer(manufacturer);
        await this.support.recordMutation(
          {
            action: AUDIT_POINTS.inventoryPartCatalogChange,
            entityType: 'Manufacturer',
            entityId: manufacturer.id,
            metadata: manufacturer,
            eventName: 'manufacturer.created',
            successMetricName: 'inventory.catalog.manufacturer.created'
          },
          context
        );
        return manufacturer;
      }
    );
  }

  async updateManufacturer(
    input: UpdateManufacturerRequest,
    context: CommandContext
  ): Promise<ManufacturerContract> {
    return this.support.withObservedExecution(
      'inventory.catalog.update_manufacturer',
      context,
      async () => {
        const existing = await this.deps.repository.findManufacturerById(input.manufacturerId);
        if (!existing) {
          throw new InvariantViolationError(`Manufacturer not found: ${input.manufacturerId}`);
        }

        const updated: Manufacturer = { ...existing };
        const changedFields: string[] = [];

        if (input.name !== undefined) {
          const name = input.name.trim();
          if (!name) throw new InvariantViolationError('Manufacturer name cannot be empty');
          if (name !== existing.name) {
            changedFields.push('name');
            updated.name = name;
          }
        }
        if (input.website !== undefined) {
          const website = input.website === null ? undefined : input.website.trim() || undefined;
          if (website !== existing.website) {
            changedFields.push('website');
            updated.website = website;
          }
        }
        if (input.notes !== undefined) {
          const notes = input.notes === null ? undefined : input.notes.trim() || undefined;
          if (notes !== existing.notes) {
            changedFields.push('notes');
            updated.notes = notes;
          }
        }
        if (input.state !== undefined && input.state !== existing.state) {
          assertTransitionAllowed(existing.state, input.state, ManufacturerDesign.lifecycle);
          changedFields.push('state');
          updated.state = input.state;
        }

        updated.updatedAt = new Date().toISOString();
        await this.deps.repository.saveManufacturer(updated);
        await this.support.recordMutation(
          {
            action: AUDIT_POINTS.inventoryPartCatalogChange,
            entityType: 'Manufacturer',
            entityId: updated.id,
            metadata: { manufacturerId: updated.id, changedFields, state: updated.state },
            eventName: 'manufacturer.updated',
            successMetricName: 'inventory.catalog.manufacturer.updated'
          },
          context
        );
        return updated;
      }
    );
  }

  async listManufacturers(
    query: ListManufacturersRequest,
    context: CommandContext
  ): Promise<ManufacturerContract[]> {
    return this.support.withObservedExecution(
      'inventory.catalog.list_manufacturers',
      context,
      async () => {
        const all = await this.deps.repository.listManufacturers();
        return query.state ? all.filter((m) => m.state === query.state) : all;
      }
    );
  }

  private async assertLifecycleChain(
    lifecycleLevel: LifecycleLevel,
    producedFromPartId: string | undefined,
    producedViaStage: string | undefined,
    selfPartId?: string
  ): Promise<void> {
    if (lifecycleLevel === LifecycleLevel.RAW_MATERIAL || lifecycleLevel === LifecycleLevel.RAW_COMPONENT) {
      if (producedFromPartId) {
        throw new InvariantViolationError(
          'Raw materials/components must not reference producedFromPartId'
        );
      }
      return;
    }

    if (!producedFromPartId) {
      throw new InvariantViolationError(
        `${lifecycleLevel} requires producedFromPartId pointing to its predecessor`
      );
    }

    if (producedFromPartId === selfPartId) {
      throw new InvariantViolationError('A part cannot be produced from itself');
    }

    const predecessor = await this.deps.repository.findPartSkuById(producedFromPartId);
    if (!predecessor) {
      throw new InvariantViolationError(`Predecessor part not found: ${producedFromPartId}`);
    }

    const expectedPredecessor =
      lifecycleLevel === LifecycleLevel.PREPARED_COMPONENT
        ? LifecycleLevel.RAW_COMPONENT
        : LifecycleLevel.PREPARED_COMPONENT;

    if (predecessor.lifecycleLevel !== expectedPredecessor) {
      throw new InvariantViolationError(
        `${lifecycleLevel} must be produced from a ${expectedPredecessor} (got ${predecessor.lifecycleLevel})`
      );
    }

    if (producedViaStage && predecessor.installStage && producedViaStage !== predecessor.installStage) {
      throw new InvariantViolationError(
        `producedViaStage (${producedViaStage}) must match predecessor installStage (${predecessor.installStage})`
      );
    }
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
