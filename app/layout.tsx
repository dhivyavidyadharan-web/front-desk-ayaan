import type { ReactNode } from 'react';
import './globals.css';

export const metadata = {
  title: 'Aangan front desk',
  description: 'Calls, leads and insights from the Aangan Studio call agent.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
