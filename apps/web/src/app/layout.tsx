import type { Metadata } from 'next';
import './globals.css';
import { AppShell } from '@/components/AppShell';
import ConfigureAmplifyClientSide from '@/components/ConfigureAmplify';
import { RoleProvider } from '@/lib/role-context';
import { Toaster } from 'sonner';

export const metadata: Metadata = {
  title: 'Golfin Garage ERP',
  description: 'Golf cart operations, service, and build execution for Golfin Garage.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-background text-foreground">
        <ConfigureAmplifyClientSide />
        <RoleProvider>
          <AppShell>{children}</AppShell>
          <Toaster position="bottom-right" richColors />
        </RoleProvider>
      </body>
    </html>
  );
}

