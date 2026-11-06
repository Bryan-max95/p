import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { assertSameOrigin } from '@/lib/pay/http';
import { exchangeMethodToken, getMethodSession, methodCaptureContext, publicMethodSession, savePaymentMethod } from '@/lib/storeganise/payment-methods';
import { integrationErrorResponse } from '@/lib/storeganise/webhook';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;
const headers = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' };
const cookieName = (id: string) => `pay_method_${id}`;
async function authenticated(req: NextRequest) {
  const id = z.string().uuid().parse(req.headers.get('x-pay-method-session'));
  const access = (await cookies()).get(cookieName(id))?.value;
  if (!access) throw new Error('Method session required');
  return getMethodSession(id, access);
}
export async function GET(req: NextRequest) {
  try { return NextResponse.json({ session: publicMethodSession(await authenticated(req)) }, { headers }); }
  catch { return NextResponse.json({ error: 'INVALID_OR_EXPIRED_SESSION' }, { status: 401, headers }); }
}
export async function POST(req: NextRequest) {
  try {
    assertSameOrigin(req);
    const text = await req.text();
    if (Buffer.byteLength(text) > 24000) return NextResponse.json({ error: 'REQUEST_TOO_LARGE' }, { status: 413, headers });
    const body = JSON.parse(text);
    if (body.operation === 'exchange') {
      const { token } = z.object({ operation: z.literal('exchange'), token: z.string() }).strict().parse(body);
      const result = await exchangeMethodToken(token);
      (await cookies()).set(cookieName(result.session.id), result.accessToken, { httpOnly: true,
        secure: new URL(process.env.PAY_PUBLIC_URL!).protocol === 'https:', sameSite: 'strict', path: '/', maxAge: 1800 });
      return NextResponse.json({ session: publicMethodSession(result.session) }, { headers });
    }
    const session = await authenticated(req);
    if (body.operation === 'capture-context') return NextResponse.json(await methodCaptureContext(session), { headers });
    const { token, billTo } = z.object({ operation: z.literal('save'), token: z.string(), billTo: z.unknown() }).strict().parse(body);
    return NextResponse.json({ session: await savePaymentMethod(session, { token, billTo }) }, { headers });
  } catch (error) {
    const result = integrationErrorResponse(error);
    return NextResponse.json({ error: result.error }, { status: result.status, headers });
  }
}
