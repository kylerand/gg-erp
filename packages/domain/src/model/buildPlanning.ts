import type { EntityDesign } from './shared.js';

export enum CartVehicleState {
  REGISTERED = 'REGISTERED',
  IN_BUILD = 'IN_BUILD',
  QUALITY_HOLD = 'QUALITY_HOLD',
  COMPLETED = 'COMPLETED',
  RETIRED = 'RETIRED'
}

export interface CartVehicle {
  id: string;
  vin: string;
  serialNumber: string;
  customerId: string;
  state: CartVehicleState;
  modelCode: string;
  modelYear: number;
  createdAt: string;
  updatedAt: string;
}

export const CartVehicleDesign: EntityDesign<CartVehicleState> = {
  entity: 'CartVehicle',
  purpose: 'Represents a specific vehicle unit flowing through build lifecycle.',
  keyFields: ['id', 'vin', 'serialNumber', 'customerId', 'state', 'modelCode', 'modelYear', 'updatedAt'],
  requiredIndexes: [
    { name: 'cart_vehicles_vin_uk', fields: ['vin'], unique: true },
    { name: 'cart_vehicles_serial_uk', fields: ['serialNumber'], unique: true },
    { name: 'cart_vehicles_customer_state_idx', fields: ['customerId', 'state'] }
  ],
  lifecycle: {
    initial: CartVehicleState.REGISTERED,
    terminal: [CartVehicleState.COMPLETED, CartVehicleState.RETIRED],
    transitions: [
      { from: CartVehicleState.REGISTERED, to: CartVehicleState.IN_BUILD, rule: 'Work order released' },
      { from: CartVehicleState.IN_BUILD, to: CartVehicleState.QUALITY_HOLD, rule: 'Quality issue detected' },
      { from: CartVehicleState.QUALITY_HOLD, to: CartVehicleState.IN_BUILD, rule: 'Quality hold released' },
      { from: CartVehicleState.IN_BUILD, to: CartVehicleState.COMPLETED, rule: 'Build complete' },
      { from: CartVehicleState.COMPLETED, to: CartVehicleState.RETIRED, rule: 'Vehicle retired' }
    ]
  },
  businessRules: ['VIN and serial number are immutable after registration.'],
  emittedEvents: ['cart.vehicle.registered', 'cart.vehicle.state_changed', 'cart.vehicle.completed'],
  apiOperations: [
    { method: 'POST', path: '/planning/vehicles', summary: 'Register vehicle' },
    { method: 'PATCH', path: '/planning/vehicles/:id/state', summary: 'Transition vehicle state' }
  ]
};

export enum BuildConfigurationState {
  DRAFT = 'DRAFT',
  LOCKED = 'LOCKED',
  RELEASED = 'RELEASED',
  SUPERSEDED = 'SUPERSEDED'
}

export interface BuildConfiguration {
  id: string;
  vehicleId: string;
  version: number;
  state: BuildConfigurationState;
  selectedOptions: string[];
  notes?: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export const BuildConfigurationDesign: EntityDesign<BuildConfigurationState> = {
  entity: 'BuildConfiguration',
  purpose: 'Versioned build definition for a vehicle before production release.',
  keyFields: ['id', 'vehicleId', 'version', 'state', 'selectedOptions', 'createdBy', 'updatedAt'],
  requiredIndexes: [
    { name: 'build_configs_vehicle_version_uk', fields: ['vehicleId', 'version'], unique: true },
    { name: 'build_configs_state_idx', fields: ['state'] }
  ],
  lifecycle: {
    initial: BuildConfigurationState.DRAFT,
    terminal: [BuildConfigurationState.SUPERSEDED],
    transitions: [
      {
        from: BuildConfigurationState.DRAFT,
        to: BuildConfigurationState.LOCKED,
        rule: 'Engineering lock before release'
      },
      {
        from: BuildConfigurationState.LOCKED,
        to: BuildConfigurationState.RELEASED,
        rule: 'Released to production'
      },
      {
        from: BuildConfigurationState.RELEASED,
        to: BuildConfigurationState.SUPERSEDED,
        rule: 'New configuration version replaces current release'
      }
    ]
  },
  businessRules: [
    'Only one RELEASED configuration may exist per vehicle.',
    'LOCKED/RELEASED configurations are immutable except supersede metadata.'
  ],
  emittedEvents: ['build.configuration.saved', 'build.configuration.locked', 'build.configuration.released'],
  apiOperations: [
    { method: 'POST', path: '/planning/build-configurations', summary: 'Create build configuration' },
    {
      method: 'PATCH',
      path: '/planning/build-configurations/:id/state',
      summary: 'Transition configuration state'
    }
  ]
};

export enum BomState {
  DRAFT = 'DRAFT',
  APPROVED = 'APPROVED',
  OBSOLETE = 'OBSOLETE'
}

export interface BomLine {
  id: string;
  partSkuId: string;
  quantityPerUnit: number;
  scrapFactor: number;
}

export interface Bom {
  id: string;
  configId: string;
  revision: number;
  state: BomState;
  lines: BomLine[];
  createdAt: string;
  updatedAt: string;
}

export const BomDesign: EntityDesign<BomState> = {
  entity: 'BOM',
  purpose: 'Material requirements definition tied to a released build configuration.',
  keyFields: ['id', 'configId', 'revision', 'state', 'lines', 'updatedAt'],
  requiredIndexes: [
    { name: 'bom_config_revision_uk', fields: ['configId', 'revision'], unique: true },
    { name: 'bom_state_idx', fields: ['state'] }
  ],
  lifecycle: {
    initial: BomState.DRAFT,
    terminal: [BomState.OBSOLETE],
    transitions: [
      { from: BomState.DRAFT, to: BomState.APPROVED, rule: 'Engineering approval' },
      { from: BomState.APPROVED, to: BomState.OBSOLETE, rule: 'Superseded by newer revision' }
    ]
  },
  businessRules: [
    'Each partSkuId must be unique within a BOM revision.',
    'quantityPerUnit > 0 and scrapFactor >= 0.'
  ],
  emittedEvents: ['bom.created', 'bom.approved', 'bom.obsolete'],
  apiOperations: [
    { method: 'POST', path: '/planning/boms', summary: 'Create BOM draft' },
    { method: 'PATCH', path: '/planning/boms/:id/approve', summary: 'Approve BOM revision' }
  ]
};

export enum RoutingSopStepState {
  ACTIVE = 'ACTIVE',
  DEPRECATED = 'DEPRECATED'
}

export interface RoutingSopStep {
  id: string;
  routeCode: string;
  sequence: number;
  workstationCode: string;
  expectedMinutes: number;
  state: RoutingSopStepState;
  sopReference?: string;
}

export const RoutingSopStepDesign: EntityDesign<RoutingSopStepState> = {
  entity: 'RoutingSopStep',
  purpose: 'Defines ordered production execution steps and expected effort.',
  keyFields: ['id', 'routeCode', 'sequence', 'workstationCode', 'expectedMinutes', 'state'],
  requiredIndexes: [
    { name: 'routing_steps_route_sequence_uk', fields: ['routeCode', 'sequence'], unique: true },
    { name: 'routing_steps_state_idx', fields: ['state'] }
  ],
  lifecycle: {
    initial: RoutingSopStepState.ACTIVE,
    terminal: [RoutingSopStepState.DEPRECATED],
    transitions: [
      {
        from: RoutingSopStepState.ACTIVE,
        to: RoutingSopStepState.DEPRECATED,
        rule: 'Step replaced by newer process'
      }
    ]
  },
  businessRules: [
    'sequence must be unique within routeCode.',
    'expectedMinutes must be greater than zero.'
  ],
  emittedEvents: ['routing.step.created', 'routing.step.updated', 'routing.step.deprecated'],
  apiOperations: [
    { method: 'POST', path: '/planning/routing-steps', summary: 'Create routing step' },
    { method: 'PATCH', path: '/planning/routing-steps/:id', summary: 'Update routing step' }
  ]
};

export enum WorkOrderState {
  PLANNED = 'PLANNED',
  RELEASED = 'RELEASED',
  IN_PROGRESS = 'IN_PROGRESS',
  BLOCKED = 'BLOCKED',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED'
}

export interface WorkOrder {
  id: string;
  workOrderNumber: string;
  vehicleId: string;
  buildConfigurationId: string;
  bomId: string;
  state: WorkOrderState;
  scheduledStartAt?: string;
  scheduledEndAt?: string;
  completedAt?: string;
  createdAt: string;
  updatedAt: string;
  createdByUserId?: string;
  updatedByUserId?: string;
  lastCorrelationId?: string;
}

export const WorkOrderDesign: EntityDesign<WorkOrderState> = {
  entity: 'WorkOrder',
  purpose: 'Primary production control aggregate linking vehicle, BOM, routing, and execution status.',
  keyFields: [
    'id',
    'workOrderNumber',
    'vehicleId',
    'buildConfigurationId',
    'bomId',
    'state',
    'scheduledStartAt',
    'scheduledEndAt',
    'createdAt',
    'updatedAt'
  ],
  requiredIndexes: [
    { name: 'work_orders_number_uk', fields: ['workOrderNumber'], unique: true },
    { name: 'work_orders_state_idx', fields: ['state'] },
    { name: 'work_orders_vehicle_idx', fields: ['vehicleId'] }
  ],
  lifecycle: {
    initial: WorkOrderState.PLANNED,
    terminal: [WorkOrderState.COMPLETED, WorkOrderState.CANCELLED],
    transitions: [
      { from: WorkOrderState.PLANNED, to: WorkOrderState.RELEASED, rule: 'Ready for production release' },
      { from: WorkOrderState.RELEASED, to: WorkOrderState.IN_PROGRESS, rule: 'Technician started work' },
      { from: WorkOrderState.IN_PROGRESS, to: WorkOrderState.BLOCKED, rule: 'Execution blocked' },
      {
        from: WorkOrderState.BLOCKED,
        to: WorkOrderState.IN_PROGRESS,
        rule: 'Blocker removed and work resumed'
      },
      {
        from: WorkOrderState.IN_PROGRESS,
        to: WorkOrderState.COMPLETED,
        rule: 'All required steps and QC complete'
      },
      {
        from: WorkOrderState.PLANNED,
        to: WorkOrderState.CANCELLED,
        rule: 'Cancelled before release'
      },
      {
        from: WorkOrderState.RELEASED,
        to: WorkOrderState.CANCELLED,
        rule: 'Cancelled before work starts'
      }
    ]
  },
  businessRules: [
    'Work order must reference RELEASED build configuration and APPROVED BOM.',
    'Work order cannot complete while open technician tasks exist.',
    'Cancelled work orders cannot be resumed.'
  ],
  emittedEvents: [
    'work_order.created',
    'work_order.released',
    'work_order.started',
    'work_order.blocked',
    'work_order.completed',
    'work_order.cancelled'
  ],
  apiOperations: [
    { method: 'POST', path: '/planning/work-orders', summary: 'Create work order' },
    { method: 'GET', path: '/planning/work-orders', summary: 'List work orders' },
    { method: 'PATCH', path: '/planning/work-orders/:id/state', summary: 'Transition work order state' }
  ]
};

export enum BuildSlotState {
  PLANNED = 'PLANNED',
  LOCKED = 'LOCKED',
  EXECUTING = 'EXECUTING',
  CLOSED = 'CLOSED',
  CANCELLED = 'CANCELLED'
}

export interface BuildSlot {
  id: string;
  slotDate: string;
  workstationCode: string;
  state: BuildSlotState;
  capacityHours: number;
  usedHours: number;
  updatedAt: string;
}

export const BuildSlotDesign: EntityDesign<BuildSlotState> = {
  entity: 'BuildSlot',
  purpose: 'Represents schedulable production capacity windows.',
  keyFields: ['id', 'slotDate', 'workstationCode', 'state', 'capacityHours', 'usedHours', 'updatedAt'],
  requiredIndexes: [
    {
      name: 'build_slots_date_station_uk',
      fields: ['slotDate', 'workstationCode'],
      unique: true
    },
    { name: 'build_slots_state_idx', fields: ['state'] }
  ],
  lifecycle: {
    initial: BuildSlotState.PLANNED,
    terminal: [BuildSlotState.CLOSED, BuildSlotState.CANCELLED],
    transitions: [
      { from: BuildSlotState.PLANNED, to: BuildSlotState.LOCKED, rule: 'Plan published and frozen' },
      { from: BuildSlotState.LOCKED, to: BuildSlotState.EXECUTING, rule: 'Execution day started' },
      { from: BuildSlotState.EXECUTING, to: BuildSlotState.CLOSED, rule: 'Execution complete' },
      { from: BuildSlotState.PLANNED, to: BuildSlotState.CANCELLED, rule: 'Plan withdrawn' },
      { from: BuildSlotState.LOCKED, to: BuildSlotState.CANCELLED, rule: 'Execution cancelled before start' }
    ]
  },
  businessRules: [
    'usedHours must never exceed capacityHours.',
    'Slots in CLOSED/CANCELLED state are immutable.'
  ],
  emittedEvents: ['build_slot.planned', 'build_slot.locked', 'build_slot.capacity_exceeded', 'build_slot.closed'],
  apiOperations: [
    { method: 'POST', path: '/planning/build-slots', summary: 'Create build slot' },
    { method: 'PATCH', path: '/planning/build-slots/:id/state', summary: 'Transition build slot state' }
  ]
};

export enum LaborCapacityState {
  OPEN = 'OPEN',
  FROZEN = 'FROZEN',
  CLOSED = 'CLOSED'
}

export interface LaborCapacity {
  id: string;
  capacityDate: string;
  teamCode: string;
  state: LaborCapacityState;
  availableHours: number;
  allocatedHours: number;
  updatedAt: string;
}

export const LaborCapacityDesign: EntityDesign<LaborCapacityState> = {
  entity: 'LaborCapacity',
  purpose: 'Tracks available and allocated labor to support scheduling decisions.',
  keyFields: [
    'id',
    'capacityDate',
    'teamCode',
    'state',
    'availableHours',
    'allocatedHours',
    'updatedAt'
  ],
  requiredIndexes: [
    { name: 'labor_capacity_date_team_uk', fields: ['capacityDate', 'teamCode'], unique: true },
    { name: 'labor_capacity_state_idx', fields: ['state'] }
  ],
  lifecycle: {
    initial: LaborCapacityState.OPEN,
    terminal: [LaborCapacityState.CLOSED],
    transitions: [
      { from: LaborCapacityState.OPEN, to: LaborCapacityState.FROZEN, rule: 'Capacity freeze window' },
      { from: LaborCapacityState.FROZEN, to: LaborCapacityState.OPEN, rule: 'Freeze lifted' },
      { from: LaborCapacityState.FROZEN, to: LaborCapacityState.CLOSED, rule: 'Capacity period complete' }
    ]
  },
  businessRules: [
    'allocatedHours must be <= availableHours.',
    'CLOSED capacity records are immutable.'
  ],
  emittedEvents: ['labor_capacity.updated', 'labor_capacity.exceeded', 'labor_capacity.closed'],
  apiOperations: [
    { method: 'POST', path: '/planning/labor-capacity', summary: 'Create labor capacity record' },
    { method: 'PATCH', path: '/planning/labor-capacity/:id', summary: 'Update labor allocation/state' }
  ]
};

// ─── SOP Step Execution ───────────────────────────────────────────────────────

export type RoutingSopStepExecutionState =
  | 'PENDING'
  | 'IN_PROGRESS'
  | 'COMPLETE'
  | 'FAILED';

export interface RoutingSopStepExecution {
  id: string;
  routingStepId: string;
  workOrderId: string;
  technicianTaskId?: string;
  state: RoutingSopStepExecutionState;
  completedBy?: string;      // employeeId
  completedAt?: string;
  failedReason?: string;
  evidenceAttachmentIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface StepEvidenceAttachment {
  id: string;
  routingStepId: string;
  fileAttachmentId: string;
  uploadedBy: string;        // employeeId
  createdAt: string;
}

// ─── SOP Step Execution Events ────────────────────────────────────────────────

export type RoutingSopStepExecutionEventName =
  | 'routing_step.started'
  | 'routing_step.completed'
  | 'routing_step.failed'
  | 'routing_step.evidence_attached';

export interface RoutingSopStepStartedEvent {
  type: 'RoutingSopStepStarted';
  eventName: 'routing_step.started';
  correlationId: string;
  routingStepId: string;
  workOrderId: string;
  technicianId: string;
}

export interface RoutingSopStepCompletedEvent {
  type: 'RoutingSopStepCompleted';
  eventName: 'routing_step.completed';
  correlationId: string;
  routingStepId: string;
  workOrderId: string;
  technicianId: string;
  evidenceAttachmentIds: string[];
}
