import type { Metadata } from 'next';
import { Providers } from '@/lib/provider';
import { Nav } from '@/components/Nav';
import { WalletBar } from '@/components/WalletBar';
import './globals.css';

export const metadata: Metadata = {
  title: 'Echo Console',
  description: 'Functional reference console for Echo Protocol on Arc',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="text-gray-900 bg-white">
        <Providers>
          <Nav />
          <WalletBar />
          <main className="max-w-6xl mx-auto px-6 py-8">{children}</main>
        </Providers>
      </body>
    </html>
  );
}
