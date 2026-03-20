import type { Metadata } from 'next';
import './globals.css';
import { TechShell } from '@/components/TechShell';

export const metadata: Metadata = {
  title: 'Golfin Garage Floor Tech',
  description: 'Touch-first floor technician app for Golfin Garage.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <TechShell>{children}</TechShell>
      </body>
    </html>
  );
}
