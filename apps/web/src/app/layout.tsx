import type { Metadata } from 'next';
import { Providers } from '@/lib/provider';
import './globals.css';

export const metadata: Metadata = {
  title: 'Echo Protocol',
  description: 'Reputation-gated agent marketplace on Arc',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
