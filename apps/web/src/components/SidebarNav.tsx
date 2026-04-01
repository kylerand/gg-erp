'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import Image from 'next/image';
import {
  Wrench,
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

interface NavChild {
  label: string;
  href: string;
}

interface NavSection {
  label: string;
  href: string;
  icon: LucideIcon;
  children: NavChild[];
}

const NAV_SECTIONS: NavSection[] = [
  {
    label: 'Work Orders',
    href: '/work-orders',
    icon: Wrench,
    children: [
      { label: 'My Queue', href: '/work-orders/my-queue' },
      { label: 'Dispatch Board', href: '/work-orders/dispatch' },
      { label: 'Open / Blocked', href: '/work-orders/open' },
    ],
  },
  {
    label: 'Inventory',
    href: '/inventory',
    icon: Package,
    children: [
      { label: 'Part Lookup', href: '/inventory/parts' },
      { label: 'Reservations', href: '/inventory/reservations' },
      { label: 'Receiving', href: '/inventory/receiving' },
    ],
  },
  {
    label: 'Customers',
    href: '/customer-dealers',
    icon: Users,
    children: [
      { label: 'Customers', href: '/customer-dealers/customers' },
      { label: 'Dealers', href: '/customer-dealers/dealers' },
      { label: 'Relationships', href: '/customer-dealers/relationships' },
    ],
  },
  {
    label: 'Training',
    href: '/training',
    icon: BookOpen,
    children: [
      { label: 'My OJT', href: '/training/my-ojt' },
      { label: 'Assignments', href: '/training/assignments' },
      { label: 'SOP Library', href: '/training/sop' },
    ],
  },
  {
    label: 'Planning',
    href: '/planning',
    icon: CalendarDays,
    children: [
      { label: 'Build Slots', href: '/planning/slots' },
    ],
  },
  {
    label: 'Accounting',
    href: '/accounting',
    icon: Receipt,
    children: [
      { label: 'Sync Monitor', href: '/accounting/sync' },
      { label: 'Reconciliation', href: '/accounting/reconciliation' },
    ],
  },
  {
    label: 'Messages',
    href: '/messages',
    icon: MessageCircle,
    children: [
      { label: 'Team Channels', href: '/messages?type=TEAM' },
      { label: 'Customer Threads', href: '/messages?type=CUSTOMER' },
    ],
  },
  {
    label: 'Reporting',
    href: '/reporting',
    icon: BarChart3,
    children: [],
  },
  {
    label: 'Admin',
    href: '/admin',
    icon: Settings2,
    children: [
      { label: 'User Access', href: '/admin/access' },
      { label: 'Audit Trail', href: '/admin/audit' },
      { label: 'Integrations', href: '/admin/integrations' },
    ],
  },
];

export function SidebarNav() {
  const pathname = usePathname();

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
              <span className="brand-pill border-white/15 bg-white/10 text-[#F9F8D1]">Service OS</span>
            </div>
            <span className="text-xs uppercase tracking-[0.2em] text-white/45">ERP</span>
          </div>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto px-3 py-4">
        {NAV_SECTIONS.map((section) => {
          const Icon = section.icon;
          const isActive = pathname === section.href || pathname.startsWith(section.href + '/');
          return (
            <div key={section.href} className="mb-1.5">
              <Link
                href={section.href}
                className={`flex items-center gap-3 px-4 py-3 rounded-2xl text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-[#E37125] text-white shadow-lg shadow-[#E37125]/20'
                    : 'text-white/72 hover:bg-white/8 hover:text-white'
                }`}
              >
                <span className={`flex h-9 w-9 items-center justify-center rounded-xl ${isActive ? 'bg-white/18' : 'bg-white/8'}`}>
                  <Icon size={17} strokeWidth={isActive ? 2.5 : 2} className="flex-shrink-0" />
                </span>
                <span className="flex-1">{section.label}</span>
              </Link>
              {isActive && section.children.length > 0 && (
                <div className="ml-12 mt-2 space-y-1">
                  {section.children.map((child) => {
                    const isChildActive = pathname === child.href;
                    return (
                      <Link
                        key={child.href}
                        href={child.href}
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
