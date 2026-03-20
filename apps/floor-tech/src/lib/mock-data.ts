import type { MaterialReadiness, SyncStatus } from '@gg-erp/ui';

export interface TechQueueItem {
  id: string;
  number: string;
  title: string;
  customer: string;
  cart: string;
  bay: string;
  age: string;
  status: 'READY' | 'IN_PROGRESS' | 'BLOCKED';
  materialReadiness: MaterialReadiness;
  shortageCount?: number;
  reworkLoop: number;
  syncStatus: SyncStatus;
  checklistCompletion: string;
  nextAction: string;
}

export interface ChecklistItem {
  id: string;
  label: string;
  done: boolean;
}

export interface PartRequest {
  id: string;
  name: string;
  qty: number;
  state: 'PENDING' | 'SYNCED' | 'FAILED';
}

export interface NoteItem {
  id: string;
  author: string;
  message: string;
  createdAt: string;
}

export interface WorkOrderDetail {
  id: string;
  number: string;
  title: string;
  customer: string;
  cart: string;
  bay: string;
  status: 'READY' | 'IN_PROGRESS' | 'BLOCKED';
  eta: string;
  syncStatus: SyncStatus;
  materialReadiness: MaterialReadiness;
  shortageCount?: number;
  reworkLoop: number;
  checklist: ChecklistItem[];
  parts: PartRequest[];
  notes: NoteItem[];
}

export interface SyncQueueItem {
  id: string;
  number: string;
  title: string;
  status: SyncStatus;
  age: string;
}

export const TECH_QUEUE: TechQueueItem[] = [
  {
    id: 'wo-201',
    number: 'WO-201',
    title: 'Battery pack install + controller flash',
    customer: 'River Oaks GC',
    cart: '2023 Club Car Tempo',
    bay: 'Bay 2',
    age: 'Started 42m ago',
    status: 'IN_PROGRESS',
    materialReadiness: 'READY',
    reworkLoop: 1,
    syncStatus: 'SYNCED',
    checklistCompletion: '5 / 8 tasks complete',
    nextAction: 'Finish torque sequence',
  },
  {
    id: 'wo-204',
    number: 'WO-204',
    title: 'Lift kit + brake cable reroute',
    customer: 'Private Owner',
    cart: '2019 EZGO TXT',
    bay: 'Bay 5',
    age: 'Queued 8m ago',
    status: 'READY',
    materialReadiness: 'PARTIAL',
    shortageCount: 1,
    reworkLoop: 0,
    syncStatus: 'RETRY',
    checklistCompletion: '0 / 6 tasks complete',
    nextAction: 'Confirm rear spacer arrival',
  },
  {
    id: 'wo-198',
    number: 'WO-198',
    title: 'Accessory wiring rework',
    customer: 'Bluewater Resort',
    cart: '2022 Advanced EV',
    bay: 'Bay 1',
    age: 'Blocked 1h ago',
    status: 'BLOCKED',
    materialReadiness: 'NOT_READY',
    shortageCount: 2,
    reworkLoop: 3,
    syncStatus: 'FAILED',
    checklistCompletion: '3 / 9 tasks complete',
    nextAction: 'Needs parts manager follow-up',
  },
];

export const WORK_ORDER_DETAILS: Record<string, WorkOrderDetail> = {
  'wo-201': {
    id: 'wo-201',
    number: 'WO-201',
    title: 'Battery pack install + controller flash',
    customer: 'River Oaks GC',
    cart: '2023 Club Car Tempo',
    bay: 'Bay 2',
    status: 'IN_PROGRESS',
    eta: 'Due today · 3:30 PM',
    syncStatus: 'SYNCED',
    materialReadiness: 'READY',
    reworkLoop: 1,
    checklist: [
      { id: '1', label: 'Verify serial + battery pack SKU', done: true },
      { id: '2', label: 'Install isolation plate and harness', done: true },
      { id: '3', label: 'Torque battery tray hardware', done: false },
      { id: '4', label: 'Flash controller to regen profile', done: false },
      { id: '5', label: 'Road test and capture voltage', done: false },
    ],
    parts: [
      { id: 'p1', name: 'Battery tray hardware kit', qty: 1, state: 'SYNCED' },
      { id: 'p2', name: '48V harness clip pack', qty: 1, state: 'PENDING' },
    ],
    notes: [
      { id: 'n1', author: 'Kyler', message: 'Customer approved controller update.', createdAt: '9:12 AM' },
      { id: 'n2', author: 'Parts', message: 'Harness clips staged in Bay 2 bin.', createdAt: '9:20 AM' },
    ],
  },
  'wo-204': {
    id: 'wo-204',
    number: 'WO-204',
    title: 'Lift kit + brake cable reroute',
    customer: 'Private Owner',
    cart: '2019 EZGO TXT',
    bay: 'Bay 5',
    status: 'READY',
    eta: 'Due tomorrow · 10:00 AM',
    syncStatus: 'RETRY',
    materialReadiness: 'PARTIAL',
    shortageCount: 1,
    reworkLoop: 0,
    checklist: [
      { id: '1', label: 'Confirm spacer kit contents', done: false },
      { id: '2', label: 'Lift front suspension', done: false },
      { id: '3', label: 'Reroute and clip brake cable', done: false },
      { id: '4', label: 'Alignment check', done: false },
    ],
    parts: [
      { id: 'p1', name: 'Rear spacer kit', qty: 1, state: 'FAILED' },
      { id: 'p2', name: 'Brake cable clips', qty: 3, state: 'PENDING' },
    ],
    notes: [
      { id: 'n1', author: 'Dispatch', message: 'Pause if spacer kit is still short.', createdAt: '10:04 AM' },
    ],
  },
  'wo-198': {
    id: 'wo-198',
    number: 'WO-198',
    title: 'Accessory wiring rework',
    customer: 'Bluewater Resort',
    cart: '2022 Advanced EV',
    bay: 'Bay 1',
    status: 'BLOCKED',
    eta: 'Escalated',
    syncStatus: 'FAILED',
    materialReadiness: 'NOT_READY',
    shortageCount: 2,
    reworkLoop: 3,
    checklist: [
      { id: '1', label: 'Inspect prior accessory branch splice', done: true },
      { id: '2', label: 'Replace inline fuse holder', done: true },
      { id: '3', label: 'Re-loom under seat tray', done: false },
      { id: '4', label: 'Photo evidence for escalation', done: false },
    ],
    parts: [
      { id: 'p1', name: 'Accessory harness pigtail', qty: 1, state: 'FAILED' },
      { id: 'p2', name: 'Fuse holder 20A', qty: 2, state: 'FAILED' },
    ],
    notes: [
      { id: 'n1', author: 'Manager', message: 'Escalate if harness mismatch persists after noon.', createdAt: '8:45 AM' },
    ],
  },
};

export const TIME_ENTRIES = [
  { id: 't1', workOrder: 'WO-201', description: 'Battery tray fit-up', hours: 1.2, state: 'SYNCED' as SyncStatus },
  { id: 't2', workOrder: 'WO-201', description: 'Controller prep + flash', hours: 0.8, state: 'IN_PROGRESS' as SyncStatus },
  { id: 't3', workOrder: 'WO-198', description: 'Rework teardown', hours: 0.5, state: 'RETRY' as SyncStatus },
];

export const SYNC_QUEUE: SyncQueueItem[] = [
  { id: 's1', number: 'WO-204', title: 'Parts request: rear spacer kit', status: 'RETRY', age: 'Queued 6m ago' },
  { id: 's2', number: 'WO-198', title: 'Blocked update + escalation note', status: 'FAILED', age: 'Queued 32m ago' },
  { id: 's3', number: 'WO-201', title: 'Battery tray clip request', status: 'PENDING', age: 'Queued just now' },
];
