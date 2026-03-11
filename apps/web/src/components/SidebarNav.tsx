'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
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
    <aside className="w-56 min-h-screen bg-white border-r border-gray-200 flex flex-col flex-shrink-0">
      {/* Logo */}
      <div className="px-4 py-4 border-b border-gray-200">
        <div className="flex items-center gap-2.5">
          <div
            className="w-8 h-8 rounded-lg flex items-center justify-center text-white text-sm font-bold flex-shrink-0"
            style={{ backgroundColor: 'var(--brand-orange)' }}
          >
            GG
          </div>
          <div>
            <span className="font-semibold text-sm text-gray-900 leading-tight block">Golfin Garage</span>
            <span className="text-xs text-gray-400 leading-tight block">ERP</span>
          </div>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto py-2">
        {NAV_SECTIONS.map((section) => {
          const Icon = section.icon;
          const isActive = pathname === section.href || pathname.startsWith(section.href + '/');
          return (
            <div key={section.href} className="px-2 mb-0.5">
              <Link
                href={section.href}
                className={`flex items-center gap-2.5 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-blue-50 text-blue-600'
                    : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                }`}
              >
                <Icon size={16} strokeWidth={isActive ? 2.5 : 2} className="flex-shrink-0" />
                {section.label}
              </Link>
              {isActive && section.children.length > 0 && (
                <div className="ml-6 mt-0.5 space-y-0.5">
                  {section.children.map((child) => {
                    const isChildActive = pathname === child.href;
                    return (
                      <Link
                        key={child.href}
                        href={child.href}
                        className={`block px-3 py-1.5 text-xs rounded-md transition-colors ${
                          isChildActive
                            ? 'text-blue-600 bg-blue-50 font-medium'
                            : 'text-gray-500 hover:text-gray-800 hover:bg-gray-50'
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
      <div className="px-4 py-3 border-t border-gray-200">
        <Link
          href="/auth"
          className="flex items-center gap-2 text-xs text-gray-400 hover:text-gray-700 transition-colors"
        >
          <LogOut size={14} />
          <span>Sign out</span>
        </Link>
      </div>
    </aside>
  );
}
