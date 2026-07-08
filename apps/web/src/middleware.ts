import { NextResponse, type NextRequest } from 'next/server';

// One Vercel project serves two surfaces off different hosts:
//   echoprotocol.site / www.echoprotocol.site → marketing (the /site route)
//   app.echoprotocol.site                      → the app (the (app) route group)
//
// Locally there is no host split: everything runs on localhost, the app is served at / as usual,
// and the marketing page is previewable directly at /site.
//
// APEX_HOSTS are the marketing hosts. Anything else (app.*, previews, localhost) is treated as the
// app surface and passes through untouched.
const APEX_HOSTS = new Set(['echoprotocol.site', 'www.echoprotocol.site']);

// Where stray app paths on the apex get sent (someone typing echoprotocol.site/hire by hand).
const APP_ORIGIN = process.env.NEXT_PUBLIC_APP_URL || 'https://app.echoprotocol.site';

export function middleware(req: NextRequest) {
  const host = (req.headers.get('host') || '').toLowerCase().split(':')[0];
  const { pathname, search } = req.nextUrl;

  if (APEX_HOSTS.has(host)) {
    // Marketing home → render the /site page without changing the visible URL.
    if (pathname === '/') {
      return NextResponse.rewrite(new URL(`/site${search}`, req.url));
    }
    // Let the marketing page's own assets/segment through.
    if (pathname === '/site' || pathname.startsWith('/site/')) {
      return NextResponse.next();
    }
    // Any other path on the apex is an app path typed against the wrong host → send it to the app.
    return NextResponse.redirect(new URL(`${pathname}${search}`, APP_ORIGIN));
  }

  // App host (and local dev): serve everything as-is.
  return NextResponse.next();
}

// Skip Next internals, the API, and static assets — only page routes need host handling.
export const config = {
  matcher: ['/((?!_next/|api/|favicon.ico|icon.png|.*\\.[\\w]+$).*)'],
};
