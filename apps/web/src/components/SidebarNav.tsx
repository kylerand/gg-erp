'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const NAV_SECTIONS = [
  {
    label: 'Work Orders',
    href: '/work-orders',
    icon: '🔧',
    children: [
      { label: 'My Queue', href: '/work-orders/my-queue' },
      { label: 'Dispatch Board', href: '/work-orders/dispatch' },
      { label: 'Open / Blocked', href: '/work-orders/open' },
    ],
  },
  {
    label: 'Inventory',
    href: '/inventory',
    icon: '📦',
    children: [
      { label: 'Part Lookup', href: '/inventory/parts' },
      { label: 'Reservations', href: '/inventory/reservations' },
      { label: 'Receiving', href: '/inventory/receiving' },
    ],
  },
  {
    label: 'Customer & Dealers',
    href: '/customer-dealers',
    icon: '👥',
    children: [
      { label: 'Customers', href: '/customer-dealers/customers' },
      { label: 'Dealers', href: '/customer-dealers/dealers' },
      { label: 'Relationships', href: '/customer-dealers/relationships' },
    ],
  },
  {
    label: 'Training',
    href: '/training',
    icon: '📚',
    children: [
      { label: 'My OJT', href: '/training/my-ojt' },
      { label: 'Assignments', href: '/training/assignments' },
      { label: 'SOP Library', href: '/training/sop' },
    ],
  },
  {
    label: 'Planning',
    href: '/planning',
    icon: '📅',
    children: [
      { label: 'Build Slots', href: '/planning/slots' },
    ],
  },
  {
    label: 'Accounting',
    href: '/accounting',
    icon: '💰',
    children: [
      { label: 'Sync Monitor', href: '/accounting/sync' },
      { label: 'Reconciliation', href: '/accounting/reconciliation' },
    ],
  },
  {
    label: 'Reporting',
    href: '/reporting',
    icon: '📊',
    children: [],
  },
  {
    label: 'Admin',
    href: '/admin',
    icon: '⚙️',
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
    <aside className="w-56 min-h-screen bg-gray-900 text-gray-100 flex flex-col flex-shrink-0">
      <div className="px-4 py-5 border-b border-gray-800">
        <span className="font-bold text-base tracking-tight">⛳ Golfin Garage</span>
        <span className="block text-xs text-gray-400 mt-0.5">ERP</span>
      </div>

      <nav className="flex-1 overflow-y-auto py-3">
        {NAV_SECTIONS.map((section) => {
          const isActive = pathname === section.href || pathname.startsWith(section.href + '/');
          return (
            <div key={section.href} className="mb-1">
              <Link
                href={section.href}
                className={`flex items-center gap-2.5 px-4 py-2 text-sm font-medium transition-colors ${
                  isActive ? 'bg-gray-800 text-white' : 'text-gray-300 hover:bg-gray-800 hover:text-white'
                }`}
              >
                <span className="text-base" aria-hidden>{section.icon}</span>
                {section.label}
              </Link>
              {isActive && section.children.length > 0 && (
                <div className="ml-8 mt-0.5 space-y-0.5">
                  {section.children.map((child) => (
                    <Link
                      key={child.href}
                      href={child.href}
                      className={`block px-3 py-1.5 text-xs rounded transition-colors ${
                        pathname === child.href
                          ? 'text-yellow-400 font-medium'
                          : 'text-gray-400 hover:text-gray-100'
                      }`}
                    >
                      {child.label}
                    </Link>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </nav>

      <div className="px-4 py-4 border-t border-gray-800">
        <Link href="/auth" className="flex items-center gap-2 text-xs text-gray-400 hover:text-gray-100">
          <span aria-hidden>👤</span>
          <span>Sign out</span>
        </Link>
      </div>
    </aside>
  );
}
