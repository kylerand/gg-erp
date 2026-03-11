import { NextResponse, type NextRequest } from 'next/server';

const PUBLIC_PATHS = ['/auth'];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  const authMode = process.env.NEXT_PUBLIC_AUTH_MODE;
  if (authMode === 'mock') {
    // In mock mode, auth is handled client-side (localStorage)
    // Allow all requests through; individual pages can check role
    return NextResponse.next();
  }

  // In real mode, check for Cognito session cookie
  const hasSession = request.cookies.has('CognitoIdentityServiceProvider') ||
    request.cookies.has('amplify-signin-with-hostedUI');

  if (!hasSession) {
    return NextResponse.redirect(new URL('/auth', request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|api).*)'],
};
