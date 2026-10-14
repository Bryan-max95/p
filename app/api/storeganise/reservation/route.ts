import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { assertSameOrigin } from '@/lib/pay/http';
import { requiredUrl } from '@/lib/pay/service';
import { openReservationCheckout, reservationInput } from '@/lib/storeganise/reservation';
import { matchingOrderId, storeganiseBookingReturn } from '@/lib/storeganise/browser-entry';
import { StoreganiseIntegrationError } from '@/lib/storeganise/config';
import { StoreganiseApiError } from '@/lib/storeganise/client';

export const runtime = 'nodejs';
export const maxDuration = 60;
export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' };

/** GTM enters here by navigation. GET conveys context only; it creates no payment
 * and discloses no customer data. The authenticated POST loads the reservation.
 */
export async function GET(req: NextRequest) {
  const destination = new URL(requiredUrl('PAY_PUBLIC_URL'));
  try {
    const input = reservationInput.parse({ orderId: req.nextUrl.searchParams.get('orderId'),
      returnUrl: req.nextUrl.searchParams.get('returnUrl') ?? undefined });
    const returnUrl = storeganiseBookingReturn(input.returnUrl);
    matchingOrderId(input.orderId, returnUrl?.searchParams.get('orderId'));
    destination.searchParams.set('reservation', input.orderId);
    if (returnUrl) destination.searchParams.set('returnUrl', returnUrl.href);
  } catch { destination.searchParams.set('reservation', 'invalid'); }
  return NextResponse.redirect(destination, { status: 303, headers });
}

export async function POST(req: NextRequest) {
  try { assertSameOrigin(req); } catch { return NextResponse.json({ error: 'INVALID_ORIGIN' }, { status: 403, headers }); }
  try {
    const raw = await req.text();
    if (raw.length > 4096) return NextResponse.json({ error: 'INVALID_RESERVATION' }, { status: 400, headers });
    const input = reservationInput.parse(JSON.parse(raw));
    const returnUrl = storeganiseBookingReturn(input.returnUrl);
    matchingOrderId(input.orderId, returnUrl?.searchParams.get('orderId'));
    return NextResponse.json(await openReservationCheckout(input), { headers });
  } catch (error) {
    const code = error instanceof StoreganiseIntegrationError ? error.code :
      error instanceof z.ZodError || error instanceof SyntaxError ? 'INVALID_RESERVATION' : 'STOREGANISE_RESERVATION_UNAVAILABLE';
    const status = error instanceof StoreganiseIntegrationError ? error.httpStatus :
      error instanceof z.ZodError || error instanceof SyntaxError ? 400 :
        error instanceof StoreganiseApiError && [403,404].includes(error.status ?? 0) ? 403 : 503;
    return NextResponse.json({ error: code }, { status, headers });
  }
}
