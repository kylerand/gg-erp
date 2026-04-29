'use client';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import Image from 'next/image';
import { getLiveErpWorkspaces, normalizeErpRoute, type ErpModuleKey } from '@gg-erp/domain';
import {
  Wrench,
  DollarSign,
  Package,
  Users,
  BookOpen,
  CalendarDays,
  Receipt,
  BarChart3,
  Settings2,
  LogOut,
  MessageCircle,
  type LucideIcon,
} from 'lucide-react';

const NAV_SECTIONS = getLiveErpWorkspaces();

const ICON_BY_MODULE: Record<ErpModuleKey, LucideIcon> = {
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
};

function routeHasQuery(href: string): boolean {
  return href.includes('?');
}

function routeQueryMatches(searchParams: URLSearchParams, href: string): boolean {
  const query = href.split('?')[1]?.split('#')[0];
  if (!query) return true;

  const hrefParams = new URLSearchParams(query);
  return Array.from(hrefParams.entries()).every(([key, value]) => searchParams.get(key) === value);
}

function sectionRouteIsActive(pathname: string, href: string): boolean {
  const hrefPath = normalizeErpRoute(href);
  return pathname === hrefPath || pathname.startsWith(`${hrefPath}/`);
}

function childRouteIsActive(
  pathname: string,
  searchParams: URLSearchParams,
  href: string,
): boolean {
  if (pathname !== normalizeErpRoute(href)) return false;
  return routeHasQuery(href) ? routeQueryMatches(searchParams, href) : true;
}

export function SidebarNav() {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  return (
    <aside className="hidden xl:flex w-72 min-h-screen bg-[#211F1E] text-white border-r border-white/10 flex-col flex-shrink-0">
      {/* Logo */}
      <div className="px-5 py-5 border-b border-white/10">
        <div className="rounded-[1.4rem] border border-white/10 bg-white/5 p-4">
          <Image
            src="/brand/golfingarage-logo.svg"
            alt="Golfin Garage"
            width={190}
            height={76}
            className="h-auto w-full"
            priority
          />
          <div className="mt-4 flex items-center justify-between">
            <div>
              <span className="brand-pill border-white/15 bg-white/10 text-[#F9F8D1]">
                Service OS
              </span>
            </div>
            <span className="text-xs uppercase tracking-[0.2em] text-white/45">ERP</span>
          </div>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto px-3 py-4">
        {NAV_SECTIONS.map((section) => {
          const Icon = ICON_BY_MODULE[section.icon];
          const children = section.links.filter((child) => child.status === 'live');
          const isActive = sectionRouteIsActive(pathname, section.route);
          return (
            <div key={section.route} className="mb-1.5">
              <Link
                href={section.route}
                className={`flex items-center gap-3 px-4 py-3 rounded-2xl text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-[#E37125] text-white shadow-lg shadow-[#E37125]/20'
                    : 'text-white/72 hover:bg-white/8 hover:text-white'
                }`}
              >
                <span
                  className={`flex h-9 w-9 items-center justify-center rounded-xl ${isActive ? 'bg-white/18' : 'bg-white/8'}`}
                >
                  <Icon size={17} strokeWidth={isActive ? 2.5 : 2} className="flex-shrink-0" />
                </span>
                <span className="flex-1">{section.label}</span>
              </Link>
              {isActive && children.length > 0 && (
                <div className="ml-12 mt-2 space-y-1">
                  {children.map((child) => {
                    const isChildActive = childRouteIsActive(pathname, searchParams, child.route);
                    return (
                      <Link
                        key={child.route}
                        href={child.route}
                        className={`block px-3 py-2 text-xs rounded-xl transition-colors ${
                          isChildActive
                            ? 'text-[#F9F8D1] bg-white/10 font-semibold'
                            : 'text-white/55 hover:text-white hover:bg-white/5'
                        }`}
                      >
                        {child.label}
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="px-5 py-4 border-t border-white/10">
        <button
          onClick={async () => {
            const { doSignOut } = await import('@/lib/auth');
            await doSignOut();
            window.location.href = '/auth';
          }}
          className="flex w-full items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white/70 hover:text-white hover:bg-white/8 transition-colors"
        >
          <LogOut size={14} />
          <span>Sign out</span>
        </button>
      </div>
    </aside>
  );
}

function isHrefActive(pathname: string, href: string): boolean {
  const path = href.split(/[?#]/)[0] || href;
  return pathname === path || pathname.startsWith(`${path}/`);
}
