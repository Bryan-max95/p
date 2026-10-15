import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { authenticatedSession, assertSameOrigin } from '@/lib/pay/http';
import { publicSession } from '@/lib/pay/service';
import { repeatSandboxPayment } from '@/lib/pay/repeat-sandbox';
import { StoreganiseIntegrationError } from '@/lib/storeganise/config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;
const input = z.object({ transactionId: z.string().min(1).max(200) }).strict();
const headers = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' };

export async function POST(req: NextRequest) {
  try {
    assertSameOrigin(req);
    const session = await authenticatedSession();
    const body = input.safeParse(await req.json());
    if (!body.success) return NextResponse.json({ error: 'INVALID_REPEAT_REQUEST' }, { status: 400, headers });
    const next = await repeatSandboxPayment(session, body.data.transactionId);
    return NextResponse.json({ session: publicSession(next) }, { headers });
  } catch (error) {
    return NextResponse.json({ error: error instanceof StoreganiseIntegrationError ? error.code : 'SANDBOX_REPEAT_UNAVAILABLE' },
      { status: error instanceof StoreganiseIntegrationError ? error.httpStatus : 503, headers });
  }
}
