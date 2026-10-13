import { NextRequest, NextResponse } from 'next/server';
import { gatewayEndpoints } from './lib/cybersource/environment';

export function middleware(request: NextRequest) {
  const nonce = btoa(crypto.randomUUID());
  const dev = process.env.NODE_ENV !== 'production';
  const { flex, cardinal } = gatewayEndpoints();
  const policy = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ''} ${flex}`,
    `frame-src 'self' ${flex} ${cardinal}`,
    `connect-src 'self' ${flex}${dev ? ' ws: wss:' : ''}`,
    "img-src 'self' data: https://cdn.simpleicons.org https://www.baccredomatic.com",
    "style-src 'self' 'unsafe-inline'", "font-src 'self' data:",
    "base-uri 'self'", "object-src 'none'", "frame-ancestors 'self'",
    `form-action 'self' ${cardinal}`,
  ].join('; ');
  const headers = new Headers(request.headers);
  headers.set('x-nonce', nonce);
  headers.set('Content-Security-Policy', policy);
  const response = NextResponse.next({ request: { headers } });
  response.headers.set('Content-Security-Policy', policy);
  response.headers.set('Cache-Control', 'private, no-store');
  return response;
}
export const config = { matcher: ['/((?!api|_next/static|_next/image|favicon.ico|icon.png).*)'] };
