import { headers } from 'next/headers';
import { cookieToInitialState } from 'wagmi';
import { Providers } from '@/lib/provider';
import { config } from '@/lib/wagmi';
import { Nav } from '@/components/Nav';
import { AppFooter } from '@/components/AppFooter';
import { MaintenanceBanner } from '@/components/MaintenanceBanner';

// Chrome for the app surface (everything except the marketing page at /site): wallet Providers,
// maintenance banner, nav, and the constrained <main>. The <html>/<body>/font shell lives in the
// root layout so the marketing surface can share it without pulling in wallet context.
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // Pull the wagmi cookie on the server and seed the client provider so connection state survives
  // refresh / SSR hydration without a disconnect flicker.
  const initialState = cookieToInitialState(config, (await headers()).get('cookie'));
  return (
    <Providers initialState={initialState}>
      <MaintenanceBanner />
      <Nav />
      <main className="max-w-6xl mx-auto px-5 sm:px-6 py-8 overflow-x-hidden min-h-[70vh]">{children}</main>
      <AppFooter />
    </Providers>
  );
}
