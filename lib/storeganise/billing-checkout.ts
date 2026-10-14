import { openStoreganiseCheckout } from './checkout';

import { matchingOrderId,storeganiseBookingReturn } from './browser-entry';
import { openSignedReservationCheckout } from './reservation';
import { StoreganiseIntegrationError } from './config';

/** A signed handoff identifies an existing order/invoice; Pay resolves every amount by API. */
export async function handleBillingCheckout(payload: Record<string, unknown>) {
  if (!['billing.checkout', 'pay.checkout'].includes(String(payload.type ?? payload.event))) {
    throw new StoreganiseIntegrationError('INVALID_CHECKOUT_EVENT', 400);
  }
  const data = payload.data && typeof payload.data === 'object' ? payload.data as Record<string, unknown> : {};
  const returnUrl=storeganiseBookingReturn(data.returnUrl??payload.returnUrl);
  // The signed return URL can identify the order, but resolveCheckout must still
  // verify its API owner against the authenticated userId supplied by Storeganise.
  const orderId=matchingOrderId(data.orderId,data.jobId,returnUrl?.searchParams.get('orderId'));
  const ids = { userId:data.userId, orderId,
    siteId:data.siteId===''?undefined:data.siteId, returnUrl:returnUrl?.href };
  const checkout = orderId && !data.invoiceId
    ? await openSignedReservationCheckout(ids)
    : await openStoreganiseCheckout({ ...ids, invoiceId:data.invoiceId });
  const url = checkout.url.replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;');
  return { ...checkout, html: `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="referrer" content="no-referrer"><meta name="pay-checkout-url" content="${url}"><meta http-equiv="refresh" content="0;url=${url}"><title>Roatan Self Storage</title></head><body><a href="${url}">Continuar al pago</a></body></html>` };
}

