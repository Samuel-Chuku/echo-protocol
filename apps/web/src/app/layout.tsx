import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { cookieToInitialState } from 'wagmi';
import { Inter } from 'next/font/google';
import { Providers } from '@/lib/provider';
import { config } from '@/lib/wagmi';
import { Nav } from '@/components/Nav';
import './globals.css';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter' });

export const metadata: Metadata = {
  title: 'Echo Protocol',
  description: 'Get paid for showing up. Build reputation that travels.',
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Pull the wagmi cookie on the server and seed the client provider so connection state survives
  // refresh / SSR hydration without a disconnect flicker.
  const initialState = cookieToInitialState(config, (await headers()).get('cookie'));
  return (
    <html lang="en" className={inter.variable}>
      <body className="bg-ink text-white font-sans antialiased min-h-screen">
        <Providers initialState={initialState}>
          <Nav />
          <main className="max-w-6xl mx-auto px-5 sm:px-6 py-8 overflow-x-hidden">{children}</main>
        </Providers>
      </body>
    </html>
  );
}
