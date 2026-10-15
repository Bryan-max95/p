import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { authenticatedSession, assertSameOrigin } from '@/lib/pay/http';
import { transaction } from '@/lib/pay/db';
import type { SessionRow } from '@/lib/pay/types';
import { CyberSourceGateway, GatewayError } from '@/lib/cybersource/gateway';
import { decodeJwt } from 'jose';
import { gatewayEnvironment } from '@/lib/cybersource/environment';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

type Stage = 'origin' | 'session' | 'environment' | 'database' | 'cached-context' | 'create-context' | 'save-context' | 'commit';
type Failure = { code: string; status: number; gatewayStatus?: number; gatewayReason?: string };

class CaptureContextError extends Error {
  constructor(readonly code: string, readonly status: number) {
    super(code);
    this.name = 'CaptureContextError';
  }
}

// Translate known internal failures without logging messages, SQL, credentials or JWTs.
const knownFailures = new Map<string, Failure>([
  ['Invalid request origin', { code: 'REQUEST_ORIGIN_INVALID', status: 403 }],
  ['Payment session required', { code: 'PAYMENT_SESSION_REQUIRED', status: 401 }],
  ['Session not found', { code: 'PAYMENT_SESSION_REQUIRED', status: 401 }],
  ['Session identity mismatch', { code: 'PAYMENT_SESSION_IDENTITY_MISMATCH', status: 401 }],
  ['Invalid CYBERSOURCE_ENVIRONMENT', { code: 'PAYMENT_ENVIRONMENT_INVALID', status: 503 }],
  ['DATABASE_URL is required', { code: 'DATABASE_CONFIGURATION_MISSING', status: 503 }],
  ['Production checkout requires HTTPS', { code: 'PAY_PUBLIC_URL_INVALID', status: 503 }],
  ['Invalid capture context response', { code: 'CAPTURE_CONTEXT_RESPONSE_INVALID', status: 502 }],
  ['Invalid capture context header', { code: 'CAPTURE_CONTEXT_HEADER_INVALID', status: 502 }],
  ['Invalid capture context configuration', { code: 'CAPTURE_CONTEXT_CONFIGURATION_INVALID', status: 502 }],
  ['Capture context verification key unavailable', { code: 'CAPTURE_CONTEXT_KEY_UNAVAILABLE', status: 502 }],
]);
const gatewayReasons = new Set([
  'AUTHENTICATION_FAILED', 'UNAUTHORIZED', 'FORBIDDEN', 'ACCESS_DENIED', 'INVALID_DATA',
  'INVALID_REQUEST', 'INVALID_FIELD', 'MISSING_FIELD', 'NOT_FOUND', 'SYSTEM_ERROR',
  'SERVER_ERROR', 'RATE_LIMITED', 'TIMEOUT',
]);
const connectionCodes = new Set([
  'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN', '28P01', '3D000',
  '53300', '57P01', 'CERT_HAS_EXPIRED', 'DEPTH_ZERO_SELF_SIGNED_CERT',
]);
const jwtCodes = new Set([
  'ERR_JWT_EXPIRED', 'ERR_JWT_CLAIM_VALIDATION_FAILED', 'ERR_JWS_SIGNATURE_VERIFICATION_FAILED',
  'ERR_JWS_INVALID', 'ERR_JWT_INVALID', 'ERR_JWK_INVALID', 'ERR_JOSE_ALG_NOT_ALLOWED',
]);

function describeFailure(error: unknown, stage: Stage): Failure {
  if (error instanceof CaptureContextError) return { code: error.code, status: error.status };
  if (error instanceof GatewayError) {
    return {
      code: [401, 403].includes(error.status) ? 'CYBERSOURCE_AUTHENTICATION_FAILED' : 'CYBERSOURCE_CONTEXT_REQUEST_FAILED',
      status: [401, 403, 429, 503].includes(error.status) ? 503 : 502,
      gatewayStatus: error.status,
      gatewayReason: gatewayReasons.has(error.reason) ? error.reason : 'UNCLASSIFIED',
    };
  }
  if (error instanceof Error) {
    const known = knownFailures.get(error.message);
    if (known) return known;
    if (error.message.startsWith('CyberSource server credentials missing or invalid:')) {
      return { code: 'CYBERSOURCE_CREDENTIALS_INVALID', status: 503 };
    }
    if (error.name === 'TimeoutError' || error.name === 'AbortError') {
      return { code: 'CAPTURE_CONTEXT_TIMEOUT', status: 504 };
    }
  }
  const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined;
  if (typeof code === 'string' && jwtCodes.has(code)) return { code: 'CAPTURE_CONTEXT_VERIFICATION_FAILED', status: 502 };
  if (typeof code === 'string' && connectionCodes.has(code)) {
    return { code: ['session', 'database', 'save-context', 'commit'].includes(stage)
      ? 'DATABASE_CONNECTION_FAILED' : 'CAPTURE_CONTEXT_CONNECTION_FAILED', status: 503 };
  }
  return { code: 'CAPTURE_CONTEXT_INTERNAL_ERROR', status: 503 };
}

export async function POST(req: NextRequest) {
  const diagnosticId = randomUUID();
  let stage: Stage = 'origin';
  try {
    // Check configuration separately from an untrusted request Origin header.
    let publicUrl: URL;
    try { publicUrl = new URL(process.env.PAY_PUBLIC_URL ?? ''); }
    catch { throw new CaptureContextError('PAY_PUBLIC_URL_INVALID', 503); }
    if (!['http:', 'https:'].includes(publicUrl.protocol) || publicUrl.username || publicUrl.password) {
      throw new CaptureContextError('PAY_PUBLIC_URL_INVALID', 503);
    }
    assertSameOrigin(req);
    stage = 'session';
    const authenticated = await authenticatedSession();
    stage = 'environment';
    const environment = gatewayEnvironment();
    if (authenticated.environment !== environment) throw new CaptureContextError('SESSION_ENVIRONMENT_MISMATCH', 409);
    const gateway = new CyberSourceGateway(environment);
    stage = 'database';
    const context = await transaction(async client => {
      const locked = await client.query<SessionRow>('SELECT * FROM pay_sessions WHERE id=$1 FOR UPDATE', [authenticated.id]);
      const session = locked.rows[0];
      if (!session) throw new CaptureContextError('PAYMENT_SESSION_NOT_FOUND', 404);
      if (session.environment !== environment) throw new CaptureContextError('SESSION_ENVIRONMENT_MISMATCH', 409);
      if (!['open', 'declined'].includes(session.status)) throw new CaptureContextError('PAYMENT_SESSION_NOT_PAYABLE', 409);
      if (!(session.expires_at instanceof Date) || !Number.isFinite(session.expires_at.getTime())) {
        throw new CaptureContextError('PAYMENT_SESSION_EXPIRY_INVALID', 500);
      }
      if (session.expires_at.getTime() <= Date.now()) throw new CaptureContextError('PAYMENT_SESSION_EXPIRED', 410);

      stage = 'cached-context';
      let reusable = false;
      if (session.capture_context) {
        try {
          const expires = decodeJwt(session.capture_context).exp;
          reusable = typeof expires === 'number' && expires > Date.now() / 1000 + 60;
        } catch { /* An unreadable cached context can be replaced with a verified fresh one. */ }
      }
      if (reusable && session.capture_context) {
        // Decoding above only checks freshness. Keep signature/origin verification mandatory.
        const cached = await gateway.readCaptureContext(session.capture_context);
        stage = 'commit';
        return cached;
      }
      stage = 'create-context';
      const fresh = await gateway.createCaptureContext();
      if (!fresh?.captureContext) throw new CaptureContextError('CAPTURE_CONTEXT_EMPTY', 502);
      stage = 'save-context';
      await client.query('UPDATE pay_sessions SET capture_context=$2,updated_at=now() WHERE id=$1', [session.id, fresh.captureContext]);
      stage = 'commit';
      return fresh;
    });
    return NextResponse.json(context, { headers: { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } });
  } catch (error) {
    const failure = describeFailure(error, stage);
    console.error('[PAY_CAPTURE_CONTEXT]', { diagnosticId, stage, ...failure });
    return NextResponse.json({ error: 'SECURE_FIELDS_UNAVAILABLE', code: failure.code, diagnosticId }, {
      status: failure.status,
      headers: { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Pay-Diagnostic-Id': diagnosticId },
    });
  }
}
