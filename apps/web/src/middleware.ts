import { NextResponse, type NextRequest } from 'next/server';

const PUBLIC_PATHS = ['/auth'];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  const authMode = process.env.NEXT_PUBLIC_AUTH_MODE;
  if (authMode === 'mock') {
    return NextResponse.next();
  }

  // Amplify v6 stores auth tokens in localStorage (client-side only).
  // Server-side middleware cannot access them, so auth guards run
  // client-side in AppShell. Let all requests through here.
  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|api).*)'],
};
