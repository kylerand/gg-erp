import type { Metadata } from 'next';
import './globals.css';
import { SidebarNav } from '@/components/SidebarNav';
import { TopHeader } from '@/components/TopHeader';
import { RoleProvider } from '@/lib/role-context';
import { Toaster } from 'sonner';

export const metadata: Metadata = {
  title: 'Golfin Garage ERP',
  description: 'Internal ERP for Golfin Garage',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-background text-foreground flex">
        <RoleProvider>
          <SidebarNav />
          <div className="flex-1 min-w-0 flex flex-col">
            <TopHeader />
            <main className="flex-1 overflow-y-auto px-6 py-6">{children}</main>
          </div>
          <Toaster position="bottom-right" richColors />
        </RoleProvider>
      </body>
    </html>
  );
}

