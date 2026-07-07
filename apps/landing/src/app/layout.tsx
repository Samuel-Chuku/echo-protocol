import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter' });

export const metadata: Metadata = {
  title: 'Echo Protocol — The LP layer for human markets',
  description:
    'Get paid for showing up. Build reputation that travels. Post work, find work, and settle it on-chain in USDC on Arc.',
  metadataBase: new URL('https://echoprotocol.site'),
  openGraph: {
    title: 'Echo Protocol',
    description: 'Get paid for showing up. Build reputation that travels.',
    url: 'https://echoprotocol.site',
    siteName: 'Echo Protocol',
    type: 'website',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.variable}>
      <body className="bg-ink text-white font-sans antialiased min-h-screen">{children}</body>
    </html>
  );
}
