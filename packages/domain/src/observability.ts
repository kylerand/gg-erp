export interface MetricPoint {
  name: string;
  value: number;
  unit: 'count' | 'milliseconds';
  correlationId: string;
}

export const ERP_METRIC_NAMES = [
  'inventory.reserve.success',
  'inventory.reserve.shortage',
  'purchase_order.transition',
  'work_order.transition',
  'build_slot.capacity_conflict',
  'invoice_sync.transition'
] as const;

export type ErpMetricName = (typeof ERP_METRIC_NAMES)[number];
