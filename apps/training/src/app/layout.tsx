import type { Metadata } from 'next';
import './globals.css';
import { ConfigureAmplify } from '@/components/ConfigureAmplify';
import { AuthProvider } from '@/lib/auth-provider';
import { TrainingShell } from '@/components/TrainingShell';

export const metadata: Metadata = {
  title: 'Golfin Garage Training',
  description: 'On-the-job training portal for Golfin Garage employees.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <ConfigureAmplify />
        <AuthProvider>
          <TrainingShell>{children}</TrainingShell>
        </AuthProvider>
      </body>
    </html>
  );
}
