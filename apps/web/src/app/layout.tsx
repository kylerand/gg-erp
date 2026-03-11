import type { Metadata } from 'next';
import './globals.css';
import { SidebarNav } from '@/components/SidebarNav';
import { RoleProvider } from '@/lib/role-context';
import { Toaster } from 'sonner';

export const metadata: Metadata = {
  title: 'Golfin Garage ERP',
  description: 'Internal ERP for Golfin Garage',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-gray-50 text-gray-900 flex">
        <RoleProvider>
          <SidebarNav />
          <div className="flex-1 min-w-0">
            <main className="max-w-7xl mx-auto px-6 py-8">{children}</main>
          </div>
          <Toaster position="bottom-right" richColors />
        </RoleProvider>
      </body>
    </html>
  );
}
