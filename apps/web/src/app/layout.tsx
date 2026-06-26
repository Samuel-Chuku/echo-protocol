import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import { Providers } from '@/lib/provider';
import { Nav } from '@/components/Nav';
import './globals.css';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter' });

export const metadata: Metadata = {
  title: 'Echo Protocol',
  description: 'Get paid for showing up. Build reputation that travels.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.variable}>
      <body className="bg-ink text-white font-sans antialiased min-h-screen">
        <Providers>
          <Nav />
          <main className="max-w-6xl mx-auto px-5 sm:px-6 py-8 overflow-x-hidden">{children}</main>
        </Providers>
      </body>
    </html>
  );
}
