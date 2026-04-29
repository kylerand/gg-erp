'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import {
  BarChart3,
  BookOpen,
  CalendarDays,
  Clock,
  DollarSign,
  MessageCircle,
  Package,
  Plus,
  Receipt,
  Search,
  Settings2,
  Users,
  Wrench,
  type LucideIcon,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';

type CommandIcon = LucideIcon;

interface CommandDestination {
  label: string;
  description: string;
  href: string;
  group: string;
  keywords: string[];
  icon: CommandIcon;
}

const RECENT_ROUTES_KEY = 'gg_erp_recent_routes';
const MAX_RECENTS = 6;

const DESTINATIONS: CommandDestination[] = [
  {
    label: 'Work Orders',
    description: 'Open the full work-order list.',
    href: '/work-orders',
    group: 'Work Orders',
    keywords: ['wo', 'jobs', 'builds', 'orders'],
    icon: Wrench,
  },
  {
    label: 'Blocked Work',
    description: 'Triage work orders that need attention.',
    href: '/work-orders?status=BLOCKED',
    group: 'Work Orders',
    keywords: ['blocked', 'stalled', 'triage'],
    icon: Wrench,
  },
  {
    label: 'Dispatch Board',
    description: 'Assign and balance shop work.',
    href: '/work-orders/dispatch',
    group: 'Work Orders',
    keywords: ['dispatch', 'assign', 'tech'],
    icon: CalendarDays,
  },
  {
    label: 'New Work Order',
    description: 'Create a build or service job.',
    href: '/work-orders/new',
    group: 'Create',
    keywords: ['new', 'create', 'job'],
    icon: Plus,
  },
  {
    label: 'Quote List',
    description: 'Review quotes and customer approvals.',
    href: '/sales/quotes',
    group: 'Sales',
    keywords: ['quote', 'estimate', 'approval'],
    icon: DollarSign,
  },
  {
    label: 'New Quote',
    description: 'Start a customer quote.',
    href: '/sales/quotes/new',
    group: 'Create',
    keywords: ['new', 'quote', 'estimate'],
    icon: Plus,
  },
  {
    label: 'Sales Pipeline',
    description: 'Track opportunities and follow-ups.',
    href: '/sales/pipeline',
    group: 'Sales',
    keywords: ['opportunity', 'pipeline', 'lead'],
    icon: DollarSign,
  },
  {
    label: 'Part Lookup',
    description: 'Search parts, stock, bins, and SKUs.',
    href: '/inventory/parts',
    group: 'Inventory',
    keywords: ['parts', 'sku', 'stock', 'bin'],
    icon: Package,
  },
  {
    label: 'Reservations',
    description: 'Review reserved and short parts.',
    href: '/inventory/reservations',
    group: 'Inventory',
    keywords: ['reserve', 'shortage', 'pick'],
    icon: Package,
  },
  {
    label: 'Receiving',
    description: 'Receive purchase orders and inbound parts.',
    href: '/inventory/receiving',
    group: 'Inventory',
    keywords: ['po', 'purchase', 'receive', 'vendor'],
    icon: Package,
  },
  {
    label: 'Customers',
    description: 'Open customer and dealer records.',
    href: '/customer-dealers/customers',
    group: 'Customers',
    keywords: ['customer', 'dealer', 'contact'],
    icon: Users,
  },
  {
    label: 'Messages',
    description: 'Open team and customer conversations.',
    href: '/messages',
    group: 'Communication',
    keywords: ['chat', 'message', 'channel'],
    icon: MessageCircle,
  },
  {
    label: 'Training Assignments',
    description: 'Review OJT assignments and evidence.',
    href: '/training/assignments',
    group: 'Training',
    keywords: ['training', 'ojt', 'assignment'],
    icon: BookOpen,
  },
  {
    label: 'SOP Library',
    description: 'Find procedures and shop knowledge.',
    href: '/training/sop',
    group: 'Training',
    keywords: ['sop', 'procedure', 'knowledge'],
    icon: BookOpen,
  },
  {
    label: 'QuickBooks Customers',
    description: 'Open the live QuickBooks customer list.',
    href: '/accounting/quickbooks/customers',
    group: 'Accounting',
    keywords: ['quickbooks', 'qb', 'customer', 'accounting'],
    icon: Receipt,
  },
  {
    label: 'QuickBooks Invoices',
    description: 'Review live QuickBooks invoice activity and AR.',
    href: '/accounting/quickbooks/invoices',
    group: 'Accounting',
    keywords: ['quickbooks', 'qb', 'invoice', 'ar', 'accounting'],
    icon: Receipt,
  },
  {
    label: 'QuickBooks Chart of Accounts',
    description: 'Browse live QuickBooks chart-of-accounts rows.',
    href: '/accounting/quickbooks/chart-of-accounts',
    group: 'Accounting',
    keywords: ['quickbooks', 'qb', 'chart', 'coa', 'accounting'],
    icon: Receipt,
  },
  {
    label: 'Accounting Sync Monitor',
    description: 'Review QuickBooks queues and failures.',
    href: '/accounting/sync?view=failures',
    group: 'Accounting',
    keywords: ['quickbooks', 'sync', 'failure', 'invoice'],
    icon: Receipt,
  },
  {
    label: 'Reconciliation',
    description: 'Compare ERP and QuickBooks records.',
    href: '/accounting/reconciliation',
    group: 'Accounting',
    keywords: ['reconcile', 'quickbooks', 'accounting'],
    icon: Receipt,
  },
  {
    label: 'Reporting',
    description: 'Open operational reports and alerts.',
    href: '/reporting',
    group: 'Reports',
    keywords: ['report', 'analytics', 'dashboard'],
    icon: BarChart3,
  },
  {
    label: 'Admin Settings',
    description: 'Manage access, audit trail, and integrations.',
    href: '/admin',
    group: 'Admin',
    keywords: ['settings', 'access', 'audit', 'integrations'],
    icon: Settings2,
  },
];

const QUICK_CREATE = DESTINATIONS.filter((destination) => destination.group === 'Create');

interface RecentRoute {
  label: string;
  href: string;
  visitedAt: string;
}

function routeMatches(pathname: string, href: string): boolean {
  const [hrefPath] = href.split('?');
  return pathname === hrefPath || pathname.startsWith(`${hrefPath}/`);
}

function labelForPath(pathname: string): string {
  const destination = DESTINATIONS.find((item) => routeMatches(pathname, item.href));
  if (destination) return destination.label;
  if (pathname === '/') return 'Dashboard';
  return pathname
    .split('/')
    .filter(Boolean)
    .map((part) => part.replace(/-/g, ' '))
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' / ');
}

function readRecentRoutes(): RecentRoute[] {
  try {
    const raw = localStorage.getItem(RECENT_ROUTES_KEY);
    const parsed = raw ? (JSON.parse(raw) as RecentRoute[]) : [];
    return Array.isArray(parsed) ? parsed.slice(0, MAX_RECENTS) : [];
  } catch {
    return [];
  }
}

function destinationMatches(destination: CommandDestination, query: string): boolean {
  const haystack = [
    destination.label,
    destination.description,
    destination.group,
    ...destination.keywords,
  ]
    .join(' ')
    .toLowerCase();
  return haystack.includes(query);
}

export function GlobalCommandPalette({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const pathname = usePathname();
  const [query, setQuery] = useState('');
  const [recentRoutes, setRecentRoutes] = useState<RecentRoute[]>([]);

  useEffect(() => {
    if (!pathname || pathname.startsWith('/auth')) return;

    const nextRecent: RecentRoute = {
      label: labelForPath(pathname),
      href: pathname,
      visitedAt: new Date().toISOString(),
    };
    const existing = readRecentRoutes().filter((item) => item.href !== pathname);
    const nextRoutes = [nextRecent, ...existing].slice(0, MAX_RECENTS);
    localStorage.setItem(RECENT_ROUTES_KEY, JSON.stringify(nextRoutes));
    setRecentRoutes(nextRoutes);
  }, [pathname]);

  useEffect(() => {
    if (!open) return;
    setRecentRoutes(readRecentRoutes());
    setQuery('');
  }, [open]);

  const results = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return DESTINATIONS.slice(0, 10);
    return DESTINATIONS.filter((destination) => destinationMatches(destination, normalizedQuery));
  }, [query]);

  return (
    <Dialog open={open} onOpenChange={(nextOpen: boolean) => { if (!nextOpen) onClose(); }}>
      <DialogContent className="sm:max-w-2xl p-0 overflow-hidden">
        <DialogHeader className="border-b border-[#E4D8CB] px-4 py-4">
          <DialogTitle>Search ERP</DialogTitle>
          <DialogDescription>
            Find operational pages, filtered work queues, and create actions.
          </DialogDescription>
        </DialogHeader>

        <div className="p-4">
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#85776F]" />
            <Input
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search work orders, parts, customers, accounting..."
              className="h-11 pl-9"
            />
          </div>

          {!query.trim() && recentRoutes.length > 0 && (
            <section className="mt-5">
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[#85776F]">
                Recently Viewed
              </h3>
              <div className="grid gap-2 sm:grid-cols-2">
                {recentRoutes.map((route) => (
                  <Link
                    key={route.href}
                    href={route.href}
                    onClick={onClose}
                    className="flex items-center gap-3 rounded-lg border border-[#E4D8CB] bg-white px-3 py-2 text-sm transition-colors hover:border-[#E37125] hover:bg-[#FFF8EF]"
                  >
                    <Clock size={15} className="text-[#85776F]" />
                    <span className="min-w-0 flex-1 truncate font-medium text-[#211F1E]">
                      {route.label}
                    </span>
                  </Link>
                ))}
              </div>
            </section>
          )}

          {!query.trim() && (
            <section className="mt-5">
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[#85776F]">
                Quick Create
              </h3>
              <div className="grid gap-2 sm:grid-cols-2">
                {QUICK_CREATE.map((destination) => (
                  <CommandLink key={destination.href} destination={destination} onClose={onClose} />
                ))}
              </div>
            </section>
          )}

          <section className="mt-5">
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[#85776F]">
              Destinations
            </h3>
            <div className="max-h-[22rem] overflow-y-auto rounded-lg border border-[#E4D8CB] bg-white">
              {results.length > 0 ? (
                results.map((destination) => (
                  <CommandLink
                    key={destination.href}
                    destination={destination}
                    onClose={onClose}
                    compact
                  />
                ))
              ) : (
                <div className="px-4 py-8 text-center text-sm text-[#85776F]">
                  No matching ERP destination.
                </div>
              )}
            </div>
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function QuickCreateMenu({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <div className="absolute right-0 top-full z-50 mt-2 w-64 overflow-hidden rounded-xl border border-[#D9CCBE] bg-white shadow-lg">
      <div className="border-b border-[#F0E8DC] px-3 py-2 text-xs font-semibold uppercase tracking-wide text-[#85776F]">
        Create
      </div>
      {QUICK_CREATE.map((destination) => (
        <Link
          key={destination.href}
          href={destination.href}
          onClick={onNavigate}
          className="flex items-start gap-3 border-b border-[#F0E8DC] px-3 py-3 text-sm last:border-b-0 hover:bg-[#FFF8EF]"
        >
          <destination.icon size={16} className="mt-0.5 text-[#B1581B]" />
          <span>
            <span className="block font-semibold text-[#211F1E]">{destination.label}</span>
            <span className="block text-xs text-[#6E625A]">{destination.description}</span>
          </span>
        </Link>
      ))}
      <Link
        href="/messages"
        onClick={onNavigate}
        className="flex items-start gap-3 px-3 py-3 text-sm hover:bg-[#FFF8EF]"
      >
        <MessageCircle size={16} className="mt-0.5 text-[#B1581B]" />
        <span>
          <span className="block font-semibold text-[#211F1E]">New Message</span>
          <span className="block text-xs text-[#6E625A]">Open channels and start a thread.</span>
        </span>
      </Link>
    </div>
  );
}

function CommandLink({
  destination,
  onClose,
  compact = false,
}: {
  destination: CommandDestination;
  onClose: () => void;
  compact?: boolean;
}) {
  const Icon = destination.icon;
  return (
    <Link
      href={destination.href}
      onClick={onClose}
      className={`flex items-start gap-3 border-[#F0E8DC] px-3 py-3 text-sm transition-colors hover:bg-[#FFF8EF] ${
        compact ? 'border-b last:border-b-0' : 'rounded-lg border'
      }`}
    >
      <Icon size={17} className="mt-0.5 flex-shrink-0 text-[#B1581B]" />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="font-semibold text-[#211F1E]">{destination.label}</span>
          <span className="rounded-full bg-[#F9F8D1] px-2 py-0.5 text-[10px] font-semibold uppercase text-[#85776F]">
            {destination.group}
          </span>
        </span>
        <span className="mt-0.5 block text-xs text-[#6E625A]">{destination.description}</span>
      </span>
    </Link>
  );
}
