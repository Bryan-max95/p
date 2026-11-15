import crypto from 'node:crypto';
import { z } from 'zod';
import { customerGet, authenticatedCustomerToken } from './customer';
import { assertStoreganiseEnabled, assertStoreganiseTestCustomer, StoreganiseIntegrationError, storeganiseReturnUrl } from './config';
import { getJob, getUser, getUnit, assertOrderActive, assertPayable, sgId, usdAmount } from './records';
import { assertReservationReadyToPay } from './move-in-steps';
import { storeganiseGet, storeganiseRequest } from './client';
import { openStoreganiseCheckout, resolveCheckout } from './checkout';
import { transaction } from '../pay/db';
import { createCheckoutSession, requiredUrl } from '../pay/service';
import { currentBchRate, hnlCharge } from '../pay/exchange-rate';
import { billToSchema } from '../pay/billing-details';
import { needsLegacyPaymentReview } from '../pay/payment-state';
import type { SessionRow, StoreganiseContext } from '../pay/types';

export const reservationInput = z.object({ orderId: sgId, returnUrl: z.string().url().max(2000).optional() }).strict();
const orderSchema = z.object({
  id: sgId, siteId: sgId, unitTypeId: sgId, unitId: sgId.nullish(),
  orderState: z.string(), startDate: z.string(),
  invoicePreview: z.object({ total: z.number().finite() }).passthrough().nullish(),
}).passthrough();

export const reservationEventId = (environment: string, orderId: string) => `storeganise-reservation-${environment}-${orderId}`;

/** A browser ID locates an order; a verified customer token proves who may open it. */
async function readReservation(token: string, orderId: string) {
  const config = assertStoreganiseEnabled();
  sgId.parse(orderId);
  const identity = z.object({ id: sgId }).parse(await customerGet(token, '/user'));
  assertStoreganiseTestCustomer(identity.id);
  // Check ownership with the admin API as well as the customer-scoped API.
  const job = await getJob(orderId);
  if (job.ownerId !== identity.id || job.type !== 'unit_moveIn') throw new StoreganiseIntegrationError('STOREGANISE_RESERVATION_UNAVAILABLE', 403);
  assertOrderActive(job);
  const order = orderSchema.parse(await customerGet(token, `/units/orders/${orderId}?include=invoicePreview`));
  if (order.id !== orderId || job.result.siteId !== order.siteId ||
    (job.result.unitId && order.unitId && job.result.unitId !== order.unitId)) throw new StoreganiseIntegrationError('STOREGANISE_IDENTITY_MISMATCH', 403);
  return { ...config, order, job, customerId: identity.id };
}

function title(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (value && typeof value === 'object') {
    const translations = value as Record<string, unknown>;
    for (const lang of ['es', 'en']) {
      const localized = translations[lang];
      if (typeof localized === 'string' && localized.trim()) return localized.trim();
    }
  }
}

export async function openReservationCheckout(value: unknown) {
  const input = reservationInput.parse(value);
  const token = await authenticatedCustomerToken();
  const context = await readReservation(token, input.orderId);
  return openReservationForContext(input, context, token);
}

/** Call only after authenticating a server-to-server Storeganise handoff.
 * Never expose this function through the unsigned browser reservation route.
 * An account ID, email or Origin header is not proof of identity.
 */
export async function openSignedReservationCheckout(value: unknown) {
  return openVerifiedReservationCheckout(value, 'signed-checkout');
}

/** Server-only entry. The caller must authenticate a Storeganise signature or a
 * scoped grant delivered through the owner's private Storeganise profile first.
 * Never call this with an unsigned browser userId/orderId pair.
 */
export async function openVerifiedReservationCheckout(value: unknown, authentication: 'signed-checkout' | 'profile-bridge') {
  const input = reservationInput.extend({ userId: sgId, siteId: sgId.optional() }).parse(value);
  const config = assertStoreganiseEnabled();
  assertStoreganiseTestCustomer(input.userId);
  const job = await getJob(input.orderId);
  if (job.ownerId !== input.userId || job.type !== 'unit_moveIn' ||
    (input.siteId && job.result.siteId !== input.siteId)) {
    throw new StoreganiseIntegrationError('STOREGANISE_IDENTITY_MISMATCH', 403);
  }
  assertOrderActive(job);
  if (job.result.invoiceId) return openStoreganiseCheckout(input);
  // The Management Portal uses this read-only operation to preview the exact
  // initial invoice. Never use browser prices or a unit's advertised rent.
  const preview = z.object({ total: z.number().finite() }).passthrough().parse(
    await storeganiseRequest(`/jobs/${job.id}/operations/previewInvoice`, 'POST'));
  const order = orderSchema.parse({ ...job.result, id: job.id, invoicePreview: preview });
  return openReservationForContext(input, { ...config, job, order, customerId: input.userId }, undefined, authentication);
}

async function openReservationForContext(input: z.infer<typeof reservationInput>,
  context: Awaited<ReturnType<typeof readReservation>>, token?: string,
  authentication: 'signed-checkout' | 'profile-bridge' = 'signed-checkout') {
  const { order, job, customerId, environment, url } = context;
  if (job.result.invoiceId) return openStoreganiseCheckout({ userId: customerId, orderId: job.id, returnUrl: input.returnUrl });
  if (!order.invoicePreview) throw new StoreganiseIntegrationError('STOREGANISE_RESERVATION_TOTAL_UNAVAILABLE');
  const amount = usdAmount(order.invoicePreview.total);
  const [user, settings, type] = await Promise.all([
    getUser(customerId),
    storeganiseGet<{ currencyCode: string; manualPaymentMethods?: Array<{ code: string }> }>('/settings'),
    token
      ? customerGet<{ id: string; title?: unknown; name?: string; code?: string }>(token, `/sites/${order.siteId}/unit-types/${order.unitTypeId}`)
      : storeganiseGet<{ id: string; title?: unknown; name?: string; code?: string }>(`/unit-types/${order.unitTypeId}`),
  ]);
  if (user.isDisabled) throw new StoreganiseIntegrationError('CUSTOMER_DISABLED', 403);
  if (settings.currencyCode !== 'USD') throw new StoreganiseIntegrationError('STOREGANISE_CURRENCY_MISMATCH');
  if (!settings.manualPaymentMethods?.some(method => method.code === (process.env.STOREGANISE_CARD_PAYMENT_METHOD ?? 'card'))) {
    throw new StoreganiseIntegrationError('STOREGANISE_CARD_METHOD_NOT_CONFIGURED', 503);
  }
  if (type.id !== order.unitTypeId) throw new StoreganiseIntegrationError('STOREGANISE_IDENTITY_MISMATCH', 403);
  const assignedId = order.unitId ?? job.result.unitId;
  const unit = assignedId ? await getUnit(assignedId) : undefined;
  if (unit && (unit.siteId !== order.siteId || (unit.ownerId && unit.ownerId !== customerId))) {
    throw new StoreganiseIntegrationError('STOREGANISE_IDENTITY_MISMATCH', 403);
  }
  // A unit type is explicitly a provisional selection, not an assigned/occupied unit.
  const selectionId = unit?.id ?? order.unitTypeId;
  const unitName = unit?.name ?? title(type.title) ?? type.name ?? type.code ?? 'Bodega reservada';
  const billing = billToSchema.safeParse(user.customFields?.pay_billTo);
  const billTo = billing.success ? billing.data : {
    firstName: user.firstName, lastName: user.lastName, email: user.email,
    address1: user.address ?? '', locality: '', country: '', postalCode: '',
  };
  const binding: StoreganiseContext = { kind: 'reservation', apiOrigin: url.origin, customerId,
    jobId: job.id, siteId: order.siteId, unitId: selectionId, unitTypeId: order.unitTypeId,
    reservationAuthentication: token ? 'customer-token' : authentication,
    ...(unit ? { selectedUnitId: unit.id } : {}) };
  const returnUrl = storeganiseReturnUrl(input.returnUrl);
  const rate = await currentBchRate();
  return transaction(async client => {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`pay-sg-order:${environment}:${job.id}`]);
    const eventId = reservationEventId(environment, job.id);
    const found = await client.query<SessionRow>('SELECT * FROM pay_sessions WHERE event_id=$1 FOR UPDATE', [eventId]);
    let session = found.rows[0];
    if (session) {
      const existingBinding = session.storeganise_context;
      if (!existingBinding || session.customer_id !== customerId || existingBinding.apiOrigin !== url.origin ||
        existingBinding.jobId !== job.id) throw new StoreganiseIntegrationError('STOREGANISE_IDENTITY_MISMATCH', 403);
      binding.sandboxActivation = existingBinding.sandboxActivation;
      if (existingBinding.reservationAuthentication === 'signed-checkout' || existingBinding.reservationAuthentication === 'profile-bridge') {
        binding.reservationAuthentication = existingBinding.reservationAuthentication;
      }
      if (existingBinding.kind === 'reservation' && ['open', 'declined'].includes(session.status) && !needsLegacyPaymentReview(session)) {
        // Never change a quote that is already authenticating/processing or paid.
        if (session.expires_at.getTime() <= Date.now() || Number(session.reference_usd_amount).toFixed(2) !== amount || session.currency !== 'HNL' ||
          session.unit_id !== selectionId || existingBinding.unitTypeId !== order.unitTypeId) {
          const renewed = await client.query<SessionRow>(`UPDATE pay_sessions SET reference_usd_amount=$2,amount=$3,currency='HNL',
            usd_hnl_rate=$4,fx_rate_date=$5,fx_fetched_at=$6,expires_at=now()+interval '30 minutes',
            capture_context=NULL,unit_id=$7,unit_name=$8,storeganise_context=$9,fx_indicator_id=$10,updated_at=now() WHERE id=$1 RETURNING *`,
          [session.id, amount, hnlCharge(amount, rate.hnlPerUsd), rate.hnlPerUsd, rate.rateDate, rate.fetchedAt,
            selectionId, unitName, JSON.stringify(binding),rate.indicatorId]);
          session = renewed.rows[0];
        }
        // Replace the legacy cookie dependency only after a verified handoff,
        // preserving the current quote when the reservation has not changed.
        if (!token && !['signed-checkout', 'profile-bridge'].includes(session.storeganise_context?.reservationAuthentication ?? '')) {
          session = (await client.query<SessionRow>(`UPDATE pay_sessions
            SET storeganise_context=storeganise_context || $2::jsonb,
              updated_at=now() WHERE id=$1 RETURNING *`, [session.id, JSON.stringify({ reservationAuthentication: authentication })])).rows[0];
        }
      }
    } else {
      // A webhook may have prepared the invoice checkout while this quote was fetched.
      const other = await client.query('SELECT id FROM pay_sessions WHERE environment=$1 AND order_id=$2 AND storeganise_context IS NOT NULL', [environment, job.id]);
      if (other.rowCount) throw new StoreganiseIntegrationError('STOREGANISE_RESERVATION_REFRESH_REQUIRED');
      const created = await createCheckoutSession({ eventId, customerId, orderId: job.id,
        unitId: selectionId, clientName: user.name ?? `${user.firstName} ${user.lastName}`, unitName,
        concept: 'Pago de reserva de bodega', amount, currency: 'USD', environment, source: 'storeganise',
        isTest: environment === 'sandbox', fiscalEnvironment: environment === 'sandbox' ? 'test' : 'production',
        payable: true, billTo, returnUrl, storeganiseContext: binding,
      }, { client, rate });
      session = (await client.query<SessionRow>('SELECT * FROM pay_sessions WHERE id=$1', [created.id])).rows[0];
    }
    await client.query('UPDATE pay_sessions SET return_url=$2 WHERE id=$1', [session.id, returnUrl]);
    const launch = crypto.randomBytes(32).toString('base64url');
    await client.query("DELETE FROM pay_launch_links WHERE session_id=$1 AND expires_at<now()", [session.id]);
    await client.query("INSERT INTO pay_launch_links(token_hash,session_id,expires_at) VALUES($1,$2,now()+interval '10 minutes')",
      [crypto.createHash('sha256').update(launch).digest('hex'), session.id]);
    return { sessionId: session.id, url: `${requiredUrl('PAY_PUBLIC_URL')}/?session=${encodeURIComponent(launch)}` };
  });
}

/** Read-only preflight, both before 3DS and immediately before authorization.
 * The authenticated reservation and its current quote are sufficient to pay;
 * confirmation and invoice creation belong to the post-payment delivery. */
async function verifyReservationQuote(session: SessionRow) {
  const { url, environment } = assertStoreganiseEnabled();
  assertStoreganiseTestCustomer(session.customer_id);
  const binding = session.storeganise_context!;
  if (session.environment !== environment || binding.apiOrigin !== url.origin ||
    binding.customerId !== session.customer_id || session.order_id !== binding.jobId ||
    session.unit_id !== (binding.selectedUnitId ?? binding.unitTypeId)) {
    throw new StoreganiseIntegrationError('STOREGANISE_IDENTITY_MISMATCH', 403);
  }
  const job = await getJob(binding.jobId!);
  if (job.ownerId !== session.customer_id || job.type !== 'unit_moveIn' || job.result.siteId !== binding.siteId) {
    throw new StoreganiseIntegrationError('STOREGANISE_IDENTITY_MISMATCH', 403);
  }
  assertOrderActive(job);
  assertReservationReadyToPay(job);
  if (job.result.unitTypeId !== binding.unitTypeId || (binding.selectedUnitId && job.result.unitId !== binding.selectedUnitId)) {
    throw new StoreganiseIntegrationError('INVOICE_AMOUNT_CHANGED');
  }
  let amount: string;
  if (job.result.invoiceId) {
    const resolved = await resolveCheckout({ userId: session.customer_id, orderId: job.id });
    if (resolved.invoice.siteId !== binding.siteId || (binding.selectedUnitId && resolved.unit.id !== binding.selectedUnitId)) {
      throw new StoreganiseIntegrationError('STOREGANISE_IDENTITY_MISMATCH', 403);
    }
    assertPayable(resolved);
    amount = usdAmount(resolved.invoice.balance);
  } else {
    // Independent reads run together so a reservation does not spend the bank's
    // authentication window waiting on a chain of Storeganise requests.
    const [user, settings, unit, rawPreview] = await Promise.all([
      getUser(session.customer_id),
      storeganiseGet<{ currencyCode: string; manualPaymentMethods?: Array<{ code: string }> }>('/settings'),
      job.result.unitId ? getUnit(job.result.unitId) : Promise.resolve(undefined),
      storeganiseRequest(`/jobs/${job.id}/operations/previewInvoice`, 'POST'),
    ]);
    if (user.isDisabled) throw new StoreganiseIntegrationError('CUSTOMER_DISABLED', 403);
    if (settings.currencyCode !== 'USD') throw new StoreganiseIntegrationError('STOREGANISE_CURRENCY_MISMATCH');
    if (!settings.manualPaymentMethods?.some(method => method.code === (process.env.STOREGANISE_CARD_PAYMENT_METHOD ?? 'card'))) {
      throw new StoreganiseIntegrationError('STOREGANISE_CARD_METHOD_NOT_CONFIGURED', 503);
    }
    if (unit) {
      if (unit.siteId !== binding.siteId || (unit.ownerId && unit.ownerId !== session.customer_id) ||
        ['archived', 'blocked', 'unassigned'].includes(unit.state)) {
        throw new StoreganiseIntegrationError('STOREGANISE_IDENTITY_MISMATCH', 403);
      }
    }
    // This POST only calculates Storeganise's quote. It does not submit an order,
    // create an invoice or acknowledge any booking step before bank approval.
    const preview = z.object({ total: z.number().finite() }).parse(rawPreview);
    amount = usdAmount(preview.total);
  }
  if (amount !== Number(session.reference_usd_amount).toFixed(2)) {
    throw new StoreganiseIntegrationError('INVOICE_AMOUNT_CHANGED');
  }
}

/** Keep the original authenticated handoff and quote throughout 3DS. A later
 * invoice must not replace the session binding while authorization is in flight. */
export async function prepareReservationForPayment(session: SessionRow) {
  const binding = session.storeganise_context;
  if (binding?.kind !== 'reservation' || !binding.jobId) throw new StoreganiseIntegrationError('STOREGANISE_IDENTITY_MISMATCH', 403);
  if (!['signed-checkout', 'profile-bridge'].includes(binding.reservationAuthentication ?? '')) {
    // Legacy customer-token sessions still need their authenticated customer;
    // an order ID or browser-supplied user ID never authorizes a payment.
    const token = await authenticatedCustomerToken();
    const context = await readReservation(token, binding.jobId);
    if (context.customerId !== session.customer_id || context.url.origin !== binding.apiOrigin ||
      context.environment !== session.environment || context.order.siteId !== binding.siteId ||
      context.order.unitTypeId !== binding.unitTypeId) throw new StoreganiseIntegrationError('STOREGANISE_IDENTITY_MISMATCH', 403);
    if (binding.selectedUnitId && (context.order.unitId ?? context.job.result.unitId) !== binding.selectedUnitId) {
      throw new StoreganiseIntegrationError('INVOICE_AMOUNT_CHANGED');
    }
  }
  await verifyReservationQuote(session);
}
