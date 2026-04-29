'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import {
  getErpCommandDestinations,
  getErpQuickCreateDestinations,
  normalizeErpRoute,
  type ErpCommandDestinationDescriptor,
} from '@gg-erp/domain';
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
  key: string;
  label: string;
  description: string;
  href: string;
  group: string;
  keywords: string[];
  icon: CommandIcon;
}

const RECENT_ROUTES_KEY = 'gg_erp_recent_routes';
const MAX_RECENTS = 6;

const ICON_BY_DESTINATION: Record<ErpCommandDestinationDescriptor['icon'], CommandIcon> = {
  'work-orders': Wrench,
  sales: DollarSign,
  inventory: Package,
  customers: Users,
  training: BookOpen,
  planning: CalendarDays,
  accounting: Receipt,
  messages: MessageCircle,
  reporting: BarChart3,
  admin: Settings2,
  plus: Plus,
};

function toCommandDestination(destination: ErpCommandDestinationDescriptor): CommandDestination {
  return {
    key: destination.key,
    label: destination.label,
    description: destination.description,
    href: destination.route,
    group: destination.group,
    keywords: [...destination.keywords],
    icon: ICON_BY_DESTINATION[destination.icon],
  };
}

const DESTINATIONS = getErpCommandDestinations().map(toCommandDestination);
const QUICK_CREATE = getErpQuickCreateDestinations().map(toCommandDestination);

interface RecentRoute {
  label: string;
  href: string;
  visitedAt: string;
}

function routeMatches(pathname: string, href: string): boolean {
  const hrefPath = normalizeErpRoute(href);
  return pathname === hrefPath || pathname.startsWith(`${hrefPath}/`);
}

function labelForPath(pathname: string): string {
  const destination = DESTINATIONS.filter((item) => routeMatches(pathname, item.href)).sort(
    (left, right) => normalizeErpRoute(right.href).length - normalizeErpRoute(left.href).length,
  )[0];
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

export function GlobalCommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
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
    <Dialog
      open={open}
      onOpenChange={(nextOpen: boolean) => {
        if (!nextOpen) onClose();
      }}
    >
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
                  <CommandLink key={destination.key} destination={destination} onClose={onClose} />
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
                    key={destination.key}
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
          key={destination.key}
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
