import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { storeganiseConfiguration, StoreganiseApiError } from '@/lib/storeganise/client';
import { isStoreganiseCustomerOrigin } from '@/lib/storeganise/customer-origins';
import { StoreganiseIntegrationError } from '@/lib/storeganise/config';
import { bridgeInput } from '@/lib/storeganise/bridge-protocol';
import { limitBridgeRequests, prepareProfileBridge, redeemProfileBridge } from '@/lib/storeganise/bridge';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;
const privateHeaders = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', Vary: 'Origin' };

function allowedOrigin(req: NextRequest): string | undefined {
  const origin = req.headers.get('origin');
  const { url } = storeganiseConfiguration();
  return origin && isStoreganiseCustomerOrigin(origin, url.origin) ? origin : undefined;
}

export function OPTIONS(req: NextRequest) {
  try {
    const origin = allowedOrigin(req);
    if (!origin || req.headers.get('access-control-request-method') !== 'POST') return new NextResponse(null, { status: 403, headers: privateHeaders });
    return new NextResponse(null, { status: 204, headers: { ...privateHeaders,
      'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Methods': 'POST',
      'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '300' } });
  } catch { return new NextResponse(null, { status: 503, headers: privateHeaders }); }
}

export async function POST(req: NextRequest) {
  let origin: string | undefined;
  const headers: Record<string, string> = { ...privateHeaders };
  try {
    origin = allowedOrigin(req);
    if (!origin) return NextResponse.json({ error: 'INVALID_ORIGIN' }, { status: 403, headers });
    headers['Access-Control-Allow-Origin'] = origin;
    headers['Access-Control-Expose-Headers'] = 'Retry-After';
    if (!req.headers.get('content-type')?.toLowerCase().startsWith('application/json') ||
      Number(req.headers.get('content-length') ?? 0) > 4096) {
      return NextResponse.json({ error: 'INVALID_BRIDGE_REQUEST' }, { status: 400, headers });
    }
    const raw = await req.text();
    if (Buffer.byteLength(raw, 'utf8') > 4096) throw new StoreganiseIntegrationError('INVALID_BRIDGE_REQUEST', 400);
    const input = bridgeInput.parse(JSON.parse(raw));
    const ip = req.headers.get('x-vercel-forwarded-for') ?? req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
    await limitBridgeRequests(ip);
    const result = input.operation === 'prepare' ? await prepareProfileBridge(input) : await redeemProfileBridge(input, origin);
    return NextResponse.json(result, { headers });
  } catch (error) {
    const status = error instanceof StoreganiseIntegrationError ? error.httpStatus :
      error instanceof z.ZodError || error instanceof SyntaxError ? 400 :
        error instanceof StoreganiseApiError && error.status === 429 ? 429 : 503;
    const code = error instanceof StoreganiseIntegrationError ? error.code :
      error instanceof z.ZodError || error instanceof SyntaxError ? 'INVALID_BRIDGE_REQUEST' :
        error instanceof StoreganiseApiError && error.status === 429 ? 'STOREGANISE_BRIDGE_RATE_LIMITED' :
          error instanceof StoreganiseApiError && error.status ? `STOREGANISE_API_HTTP_${error.status}` : 'STOREGANISE_BRIDGE_UNAVAILABLE';
    // The per-customer provisioning limit can last ten minutes. This is a
    // conservative client pause, not an assertion about Storeganise's own limit.
    if (status === 429) headers['Retry-After'] = '600';
    return NextResponse.json({ error: code }, { status, headers });
  }
}
