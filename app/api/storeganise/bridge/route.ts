import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { storeganiseConfiguration } from '@/lib/storeganise/client';
import { isStoreganiseCustomerOrigin } from '@/lib/storeganise/customer-origins';
import { StoreganiseIntegrationError } from '@/lib/storeganise/config';
import { bridgeInput } from '@/lib/storeganise/bridge-protocol';
import { limitBridgeRequests, prepareProfileBridge, redeemProfileBridge } from '@/lib/storeganise/bridge';
import { describeBridgeFailure, type BridgeStage } from '@/lib/storeganise/bridge-diagnostics';

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
  } catch (error) {
    const diagnosticId = randomUUID();
    const failure = describeBridgeFailure(error, 'origin');
    console.error('[PAY_STOREGANISE_BRIDGE]', { diagnosticId, stage: 'origin', ...failure });
    return new NextResponse(null, { status: 503, headers: { ...privateHeaders, 'X-Pay-Diagnostic-Id': diagnosticId } });
  }
}

export async function POST(req: NextRequest) {
  const diagnosticId = randomUUID();
  let stage: BridgeStage = 'origin';
  let origin: string | undefined;
  const headers: Record<string, string> = { ...privateHeaders };
  try {
    origin = allowedOrigin(req);
    if (!origin) return NextResponse.json({ error: 'INVALID_ORIGIN' }, { status: 403, headers });
    headers['Access-Control-Allow-Origin'] = origin;
    headers['Access-Control-Expose-Headers'] = 'Retry-After, X-Pay-Diagnostic-Id';
    stage = 'request';
    if (!req.headers.get('content-type')?.toLowerCase().startsWith('application/json') ||
      Number(req.headers.get('content-length') ?? 0) > 4096) {
      return NextResponse.json({ error: 'INVALID_BRIDGE_REQUEST' }, { status: 400, headers });
    }
    const raw = await req.text();
    if (Buffer.byteLength(raw, 'utf8') > 4096) throw new StoreganiseIntegrationError('INVALID_BRIDGE_REQUEST', 400);
    const input = bridgeInput.parse(JSON.parse(raw));
    const ip = req.headers.get('x-vercel-forwarded-for') ?? req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
    stage = 'rate-limit';
    await limitBridgeRequests(ip);
    stage = input.operation;
    const result = input.operation === 'prepare' ? await prepareProfileBridge(input) : await redeemProfileBridge(input, origin);
    return NextResponse.json(result, { headers });
  } catch (error) {
    const failure = describeBridgeFailure(error, stage);
    const { code, status } = failure;
    console.error('[PAY_STOREGANISE_BRIDGE]', { diagnosticId, stage, ...failure });
    headers['X-Pay-Diagnostic-Id'] = diagnosticId;
    // The per-customer provisioning limit can last ten minutes. This is a
    // conservative client pause, not an assertion about Storeganise's own limit.
    if (status === 429) headers['Retry-After'] = '600';
    // Keep the existing GTM V8 contract; detailed codes and a correlation ID
    // are available in Network/Response and the matching Vercel log.
    const publicCode = error instanceof StoreganiseIntegrationError ||
      /^(INVALID_BRIDGE_REQUEST|INVALID_STOREGANISE_DATA|STOREGANISE_BRIDGE_RATE_LIMITED|STOREGANISE_API_HTTP_\d{3})$/.test(code)
      ? code : 'STOREGANISE_BRIDGE_UNAVAILABLE';
    return NextResponse.json({ error: publicCode, code, diagnosticId }, { status, headers });
  }
}
