import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter' });

export const metadata: Metadata = {
  title: 'Echo Protocol',
  description: 'Get paid for showing up. Build reputation that travels.',
};

// Root shell only: <html>/<body>/font/globals shared by both the app surface (the (app) route
// group, which adds wallet chrome in its own layout) and the marketing surface (/site).
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.variable}>
      <body className="bg-ink text-white font-sans antialiased min-h-screen">{children}</body>
    </html>
  );
}
