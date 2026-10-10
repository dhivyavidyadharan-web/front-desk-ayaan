import type { ReactNode } from 'react';

export const metadata = {
  title: 'Aangan front desk',
  description: 'Calls, leads and insights from the Aangan Studio call agent.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: 'system-ui, sans-serif', margin: 0 }}>{children}</body>
    </html>
  );
}
