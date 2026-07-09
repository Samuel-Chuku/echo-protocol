import Image from 'next/image';
import Link from 'next/link';
import { ArcMark, Socials } from './ui';

// Slim footer shown on every app page. The marketing surface (/site) uses the full <Footer/>.
const APP_LINKS = [
  { label: 'Find work', href: '/apply' },
  { label: 'Post a job', href: '/hire' },
  { label: 'Introducer', href: '/attribution' },
  { label: 'Activity', href: '/activity' },
];

export function AppFooter() {
  return (
    <footer className="border-t border-white/[0.08] mt-16">
      <div className="max-w-6xl mx-auto px-5 sm:px-6 py-8">
        <div className="flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-5">
            <Link href="/" className="shrink-0">
              <Image src="/logo-white.png" alt="Echo Protocol" width={255} height={60} className="h-7 w-auto" />
            </Link>
            <nav className="hidden md:flex items-center gap-4">
              {APP_LINKS.map((l) => (
                <Link key={l.href} href={l.href} className="text-sm text-white/50 hover:text-white transition">
                  {l.label}
                </Link>
              ))}
            </nav>
          </div>
          <Socials />
        </div>

        <div className="mt-6 flex flex-col gap-2 border-t border-white/[0.06] pt-5 text-xs text-white/30 sm:flex-row sm:items-center sm:justify-between">
          <span>© 2026 Echo Protocol</span>
          <span className="flex items-center gap-1.5">
            Built on <ArcMark className="h-3 w-3 text-white/40" /> Arc Network · Powered by USDC
          </span>
        </div>
      </div>
    </footer>
  );
}
