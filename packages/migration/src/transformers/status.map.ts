// ShopMonkey work order status → ERP WorkOrderStatus
const STATUS_MAP: Record<string, string> = {
  'Open': 'PLANNED',
  'Estimate': 'PLANNED',
  'In Progress': 'IN_PROGRESS',
  'Pending Parts': 'BLOCKED',
  'Pending Customer': 'BLOCKED',
  'Complete': 'COMPLETED',
  'Invoiced': 'COMPLETED',
  'Paid': 'COMPLETED',
  'Cancelled': 'COMPLETED',
  'Void': 'COMPLETED',
};

export function mapWorkOrderStatus(shopMonkeyStatus: string): string {
  return STATUS_MAP[shopMonkeyStatus] ?? 'PLANNED';
}

// ShopMonkey employee role → ERP role
const ROLE_MAP: Record<string, string> = {
  'Admin': 'MANAGER',
  'Manager': 'MANAGER',
  'Technician': 'TECHNICIAN',
  'Service Advisor': 'SERVICE_ADVISOR',
  'Parts': 'PARTS_SPECIALIST',
  'Customer Service': 'SERVICE_ADVISOR',
};

export function mapEmployeeRole(shopMonkeyRole: string): string {
  return ROLE_MAP[shopMonkeyRole] ?? 'TECHNICIAN';
}
