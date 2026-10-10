import type { ReactNode } from 'react';
import { Fraunces } from 'next/font/google';
import './globals.css';
import { LampLight } from './lamp-light';

const display = Fraunces({ subsets: ['latin'], weight: ['400', '500', '600'], variable: '--font-display' });

export const metadata = {
  title: 'Aangan front desk',
  description: 'Calls, leads and insights from the Aangan Studio call agent.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={display.variable}>
      <body>
        <LampLight />
        {children}
      </body>
    </html>
  );
}
