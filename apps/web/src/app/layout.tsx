import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { cookieToInitialState } from 'wagmi';
import { Providers } from '@/lib/provider';
import { config } from '@/lib/wagmi';
import { Nav } from '@/components/Nav';
import './globals.css';

export const metadata: Metadata = {
  title: 'Echo Console',
  description: 'Functional reference console for Echo Protocol on Arc',
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Pull the wagmi cookie on the server and seed the client provider so connection state survives
  // refresh / SSR hydration without a disconnect flicker.
  const initialState = cookieToInitialState(config, (await headers()).get('cookie'));
  return (
    <html lang="en">
      <body className="text-gray-900 bg-white">
        <Providers initialState={initialState}>
          <Nav />
          <main className="max-w-6xl mx-auto px-6 py-8">{children}</main>
        </Providers>
      </body>
    </html>
  );
}
