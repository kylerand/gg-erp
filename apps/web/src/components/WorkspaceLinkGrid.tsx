'use client';

import Link from 'next/link';
import {
  getErpWorkspaceNavigationItems,
  type ErpModuleKey,
  type ErpWorkspaceNavigationItemDescriptor,
} from '@gg-erp/domain';
import {
  BarChart3,
  BookOpen,
  ClipboardCheck,
  ClipboardList,
  Factory,
  FilePlus2,
  FileText,
  GitBranch,
  Inbox,
  ListChecks,
  Package,
  PackageCheck,
  Plus,
  Receipt,
  Scale,
  Search,
  Settings2,
  ShieldCheck,
  Truck,
  Users,
  Wrench,
  type LucideIcon,
} from 'lucide-react';

const ICON_BY_ITEM_KEY: Partial<Record<string, LucideIcon>> = {
  'my-work-queue': ClipboardList,
  'dispatch-board': ListChecks,
  'blocked-work': ShieldCheck,
  'time-logging': ClipboardCheck,
  'qc-checklist': ClipboardCheck,
  'sop-runner': BookOpen,
  'sales-pipeline': BarChart3,
  quote: FileText,
  'sales-forecast': BarChart3,
  part: Search,
  'inventory-reservation': PackageCheck,
  receiving: Truck,
  manufacturer: Factory,
  'material-planning': BarChart3,
  customer: Users,
  dealer: Users,
  'customer-relationship': GitBranch,
  'my-ojt': BookOpen,
  'training-assignment': ClipboardList,
  'sop-library': BookOpen,
  'training-admin': Settings2,
  'build-slot': ListChecks,
  'accounting-sync': Receipt,
  'accounting-reconciliation': Scale,
  'quickbooks-customer': Users,
  'quickbooks-invoice': FileText,
  'quickbooks-chart-of-accounts': Receipt,
  'user-access': Users,
  'audit-trail': ShieldCheck,
  'integration-settings': Settings2,
  'create-work-order': FilePlus2,
  'create-quote': FilePlus2,
  'create-message-thread': Plus,
};

const FALLBACK_ICON_BY_MODULE: Record<ErpModuleKey, LucideIcon> = {
  'work-orders': Wrench,
  sales: BarChart3,
  inventory: Package,
  customers: Users,
  training: BookOpen,
  planning: ListChecks,
  accounting: Receipt,
  messages: Inbox,
  reporting: BarChart3,
  admin: Settings2,
};

function iconForItem(item: ErpWorkspaceNavigationItemDescriptor): LucideIcon {
  return ICON_BY_ITEM_KEY[item.key] ?? FALLBACK_ICON_BY_MODULE[item.module];
}

export function WorkspaceLinkGrid({
  moduleKey,
  variant = 'cards',
  className,
}: {
  moduleKey: ErpModuleKey;
  variant?: 'cards' | 'pills';
  className?: string;
}) {
  const items = getErpWorkspaceNavigationItems(moduleKey);

  if (variant === 'pills') {
    return (
      <div className={className ?? 'mb-6 flex flex-wrap gap-3'}>
        {items.map((item) => {
          const Icon = iconForItem(item);
          return (
            <Link
              key={item.key}
              href={item.route}
              className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm text-gray-600 transition-colors hover:border-yellow-400 hover:text-gray-900"
            >
              <Icon size={15} className="text-[#B1581B]" />
              {item.label}
            </Link>
          );
        })}
      </div>
    );
  }

  return (
    <div className={className ?? 'grid grid-cols-2 gap-4 sm:grid-cols-3'}>
      {items.map((item) => {
        const Icon = iconForItem(item);
        return (
          <Link
            key={item.key}
            href={item.route}
            className="rounded-lg border border-gray-200 bg-white p-5 transition-all hover:border-yellow-400 hover:shadow-sm"
          >
            <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-[#FFF3E8] text-[#B1581B]">
              <Icon size={19} />
            </div>
            <div className="text-sm font-semibold text-gray-900">{item.label}</div>
            <div className="mt-0.5 text-xs text-gray-500">{item.description}</div>
          </Link>
        );
      })}
    </div>
  );
}
