import crypto from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { assertSameOrigin } from '@/lib/pay/http';
import { query } from '@/lib/pay/db';
import { signInCustomer, clearCustomerSession } from '@/lib/storeganise/customer';
import { assertStoreganiseEnabled, StoreganiseIntegrationError } from '@/lib/storeganise/config';
import { StoreganiseApiError } from '@/lib/storeganise/client';

export const runtime = 'nodejs';
export const maxDuration = 30;
const headers = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' };
const login = z.object({ email: z.string().trim().email().max(254), password: z.string().min(1).max(1024) }).strict();

async function limit(key: string, maximum: number) {
  const secret = process.env.PAY_SESSION_TOKEN_SECRET;
  if (!secret || secret.length < 32) throw new StoreganiseIntegrationError('STOREGANISE_SESSION_CONFIGURATION', 503);
  const hash = crypto.createHmac('sha256', secret).update(`sg-login:${key}`).digest('hex');
  const result = await query<{ attempts: number }>(`INSERT INTO pay_customer_login_limits(key_hash,attempts,expires_at)
    VALUES($1,1,now()+interval '15 minutes') ON CONFLICT(key_hash) DO UPDATE SET
    attempts=CASE WHEN pay_customer_login_limits.expires_at<now() THEN 1 ELSE pay_customer_login_limits.attempts+1 END,
    expires_at=CASE WHEN pay_customer_login_limits.expires_at<now() THEN now()+interval '15 minutes' ELSE pay_customer_login_limits.expires_at END
    RETURNING attempts`, [hash]);
  if (result.rows[0].attempts > maximum) throw new StoreganiseIntegrationError('STOREGANISE_LOGIN_RATE_LIMITED', 429);
}

export async function POST(req: NextRequest) {
  try { assertSameOrigin(req); } catch { return NextResponse.json({ error: 'INVALID_ORIGIN' }, { status: 403, headers }); }
  try {
    assertStoreganiseEnabled();
    const raw = await req.text();
    if (raw.length > 4096) return NextResponse.json({ error: 'INVALID_LOGIN' }, { status: 400, headers });
    const parsed = login.safeParse(JSON.parse(raw));
    if (!parsed.success) return NextResponse.json({ error: 'INVALID_LOGIN' }, { status: 400, headers });
    // Vercel overwrites the forwarded address. Never use user IDs or order IDs as authentication.
    const ip = req.headers.get('x-vercel-forwarded-for') ?? req.headers.get('x-forwarded-for')?.split(',')[0] ?? 'unknown';
    await limit(`ip:${ip}`, 30);
    await limit(`email:${parsed.data.email.toLowerCase()}`, 8);
    await query('DELETE FROM pay_customer_login_limits WHERE expires_at<now()');
    await signInCustomer(parsed.data.email, parsed.data.password);
    return NextResponse.json({ authenticated: true }, { headers });
  } catch (error) {
    const code = error instanceof StoreganiseIntegrationError ? error.code : 'STOREGANISE_LOGIN_UNAVAILABLE';
    const status = error instanceof StoreganiseIntegrationError ? error.httpStatus :
      error instanceof StoreganiseApiError && [400,403].includes(error.status ?? 0) ? 401 : 503;
    return NextResponse.json({ error: code }, { status, headers });
  }
}

export async function DELETE(req: NextRequest) {
  try { assertSameOrigin(req); } catch { return NextResponse.json({ error: 'INVALID_ORIGIN' }, { status: 403, headers }); }
  await clearCustomerSession();
  return NextResponse.json({ authenticated: false }, { headers });
}
