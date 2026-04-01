import type { Metadata } from 'next';
import './globals.css';
import ConfigureAmplifyClientSide from '@/components/ConfigureAmplify';
import { AuthProvider } from '@/lib/auth-provider';
import { TechShell } from '@/components/TechShell';

export const metadata: Metadata = {
  title: 'Golfin Garage Floor Tech',
  description: 'Touch-first floor technician app for Golfin Garage.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <ConfigureAmplifyClientSide />
        <AuthProvider>
          <TechShell>{children}</TechShell>
        </AuthProvider>
      </body>
    </html>
  );
}
