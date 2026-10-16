import crypto from 'node:crypto';
import { z } from 'zod';
import { assertStoreganiseEnabled, assertStoreganiseTestCustomer, StoreganiseIntegrationError, storeganiseReturnUrl } from './config';
import { isLiveStoreganiseSandbox } from './payment-policy';
import { assertOrderActive, assertPayable, getJob, getUser, invoiceContext, sgId, usdAmount } from './records';
import { storeganiseGet } from './client';
import { createCheckoutSession, requiredUrl } from '../pay/service';
import { transaction } from '../pay/db';
import { currentBchRate, hnlCharge } from '../pay/exchange-rate';
import { needsLegacyPaymentReview } from '../pay/payment-state';
import { billToSchema } from '../pay/billing-details';
import type { BillTo } from '../cybersource/types';
import type { SessionRow, StoreganiseContext } from '../pay/types';

export const checkoutIdsSchema = z.object({ userId: sgId, invoiceId: sgId.optional(), orderId: sgId.optional(),
  jobId: sgId.optional(), siteId:sgId.optional(), returnUrl: z.string().url().max(2000).optional(),
}).refine(value => Boolean(value.invoiceId || value.orderId || value.jobId), 'An invoice or order ID is required');

export async function resolveCheckout(value: unknown) {
  const { url, environment } = assertStoreganiseEnabled();
  const ids = checkoutIdsSchema.parse(value);
  assertStoreganiseTestCustomer(ids.userId);
  if(ids.orderId&&ids.jobId&&ids.orderId!==ids.jobId)throw new StoreganiseIntegrationError('STOREGANISE_IDENTITY_MISMATCH',403);
  const orderId = ids.orderId ?? ids.jobId;
  const job = orderId ? await getJob(orderId) : undefined;
  if (job && (job.ownerId !== ids.userId || job.type !== 'unit_moveIn')) throw new StoreganiseIntegrationError('STOREGANISE_IDENTITY_MISMATCH', 403);
  if(job)assertOrderActive(job);
  const invoiceId = ids.invoiceId ?? job?.result.invoiceId;
  // Native "add card" checkout may precede confirmation/invoice creation. Do not
  // guess the balance from a unit's advertised rent, or choose a user's latest invoice.
  if (!invoiceId) throw new StoreganiseIntegrationError('ORDER_REQUIRES_CONFIRMED_INVOICE');
  const context = await invoiceContext(invoiceId, ids.userId, orderId);
  if(ids.siteId&&context.invoice.siteId!==ids.siteId)throw new StoreganiseIntegrationError('STOREGANISE_IDENTITY_MISMATCH',403);
  const [user, settings] = await Promise.all([getUser(ids.userId), storeganiseGet<{ currencyCode: string; manualPaymentMethods?: Array<{ code: string }> }>('/settings')]);
  if (user.isDisabled) throw new StoreganiseIntegrationError('CUSTOMER_DISABLED', 403);
  if (settings.currencyCode !== 'USD' || (context.invoice.currencyCode && context.invoice.currencyCode !== 'USD') ||
    (context.invoice.currency && context.invoice.currency !== 'USD')) throw new StoreganiseIntegrationError('STOREGANISE_CURRENCY_MISMATCH');
  const method = process.env.STOREGANISE_CARD_PAYMENT_METHOD ?? 'card';
  if (!settings.manualPaymentMethods?.some(item => item.code === method)) throw new StoreganiseIntegrationError('STOREGANISE_CARD_METHOD_NOT_CONFIGURED', 503);
  const profileBilling = billToSchema.safeParse(user.customFields?.pay_billTo);
  const billTo: BillTo = profileBilling.success ? profileBilling.data : {
    firstName: user.firstName, lastName: user.lastName, email: user.email,
    address1: user.address ?? '', locality: '', country: '', postalCode: '',
  };
  const initialOrderId = orderId ?? (context.job && context.job.result.invoiceId === context.invoice.id ? context.job.id : undefined);
  const binding: StoreganiseContext = { kind: 'invoice', apiOrigin: url.origin, customerId: user.id, invoiceId: context.invoice.id,
    rentalId: context.rental.id, unitId: context.unit.id, siteId: context.invoice.siteId,
    ...(initialOrderId ? { jobId: initialOrderId } : {}),
  };
  return { ...context, environment, user, billTo, binding, returnUrl: storeganiseReturnUrl(ids.returnUrl) };
}

export async function openStoreganiseCheckout(value: unknown) {
  const context = await resolveCheckout(value);
  const { invoice, rental, unit, user, environment, binding, billTo } = context;
  // Obtain the shared rate before taking a checkout connection/lock. Otherwise
  // simultaneous checkouts could exhaust the pool while waiting for another one.
  const rate = ['sent','overdue'].includes(invoice.state)&&invoice.balance>0 ? await currentBchRate() : undefined;
  return transaction(async client => {
    if (binding.jobId) await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`pay-sg-order:${environment}:${binding.jobId}`]);
    // One quote/session per invoice, even when webhook calls arrive concurrently.
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`pay-sg:${environment}:${invoice.id}`]);
    const found = await client.query<SessionRow>(`SELECT * FROM pay_sessions WHERE environment=$1 AND
      (invoice_id=$2 OR event_id=$3) ORDER BY created_at FOR UPDATE`,
    [environment, invoice.id, binding.jobId ? `storeganise-reservation-${environment}-${binding.jobId}` : '']);
    if (found.rows.length > 1) throw new StoreganiseIntegrationError('STOREGANISE_RESERVATION_REFRESH_REQUIRED');
    let session = found.rows[0];
    if (session) {
      const reservation = session.storeganise_context?.kind === 'reservation';
      if (!session.storeganise_context || session.customer_id !== user.id ||
        (!reservation && (session.unit_id !== unit.id || session.storeganise_context.rentalId !== rental.id)) ||
        (reservation && (session.storeganise_context.jobId !== binding.jobId || session.storeganise_context.siteId !== binding.siteId)) ||
        session.storeganise_context.apiOrigin !== binding.apiOrigin) {
        throw new StoreganiseIntegrationError('STOREGANISE_IDENTITY_MISMATCH', 403);
      }
      if (reservation) {
        if (!['open','declined'].includes(session.status) || needsLegacyPaymentReview(session)) throw new StoreganiseIntegrationError('STOREGANISE_RESERVATION_REFRESH_REQUIRED');
        assertPayable(context);
        binding.sandboxActivation = session.storeganise_context.sandboxActivation;
        session = (await client.query<SessionRow>(`UPDATE pay_sessions SET invoice_id=$2,unit_id=$3,unit_name=$4,
          storeganise_context=$5,updated_at=now() WHERE id=$1 RETURNING *`,
        [session.id,invoice.id,unit.id,unit.name,JSON.stringify(binding)])).rows[0];
      }
      if (['open', 'declined'].includes(session.status) && !needsLegacyPaymentReview(session)) {
        assertPayable(context);
        const amount = usdAmount(invoice.balance);
        const changed = Number(session.reference_usd_amount).toFixed(2) !== amount;
        if (session.expires_at.getTime() <= Date.now() || changed) {
          if(!rate)throw new StoreganiseIntegrationError('EXCHANGE_RATE_UNAVAILABLE',503);
          const renewed = await client.query<SessionRow>(`UPDATE pay_sessions SET reference_usd_amount=$2,amount=$3,
            usd_hnl_rate=$4,fx_source='BCH',fx_rate_date=$5,fx_fetched_at=$6,expires_at=now()+interval '30 minutes',
            capture_context=NULL,updated_at=now() WHERE id=$1 RETURNING *`,
          [session.id,amount,hnlCharge(amount,rate.hnlPerUsd),rate.hnlPerUsd,rate.rateDate,rate.fetchedAt]);
          session = renewed.rows[0];
        }
      }
      if(context.returnUrl!==session.return_url){
        await client.query('UPDATE pay_sessions SET return_url=$2,updated_at=now() WHERE id=$1',[session.id,context.returnUrl]);
        session.return_url=context.returnUrl;
      }
    } else {
      assertPayable(context);
      const created = await createCheckoutSession({
        eventId: `storeganise-${environment}-${invoice.id}`, customerId: user.id, invoiceId: invoice.id,
        orderId: binding.jobId, unitId: unit.id, clientName: user.name ?? `${user.firstName} ${user.lastName}`,
        unitName: unit.name, concept: 'Pago de bodega', amount: usdAmount(invoice.balance), currency: 'USD',
        environment, source: 'storeganise', isTest: environment === 'sandbox', fiscalEnvironment: environment === 'sandbox' ? 'test' : 'production',
        payable: true, billTo, returnUrl: context.returnUrl, storeganiseContext: binding,
      },{client,rate});
      const saved = await client.query<SessionRow>('SELECT * FROM pay_sessions WHERE id=$1', [created.id]);
      session = saved.rows[0];
    }
    // Every signed handoff has its own single-use launch token; replaying a webhook
    // never creates another invoice/session or makes an old consumed link reusable.
    const token = crypto.randomBytes(32).toString('base64url');
    await client.query("DELETE FROM pay_launch_links WHERE session_id=$1 AND expires_at<now()", [session.id]);
    await client.query("INSERT INTO pay_launch_links(token_hash,session_id,expires_at) VALUES($1,$2,now()+interval '10 minutes')", [crypto.createHash('sha256').update(token).digest('hex'),session.id]);
    return { sessionId: session.id, url: `${requiredUrl('PAY_PUBLIC_URL')}/?session=${encodeURIComponent(token)}` };
  });
}

/** Re-check the same invoice just before authorization; the browser never supplies its price. */
export async function verifyStoreganiseCheckout(session: SessionRow) {
  if (!session.storeganise_context) return;
  const { url, environment } = assertStoreganiseEnabled();
  assertStoreganiseTestCustomer(session.customer_id);
  if (session.environment !== environment || session.storeganise_context.apiOrigin !== url.origin) {
    throw new StoreganiseIntegrationError('STOREGANISE_INSTANCE_ENVIRONMENT_MISMATCH', 409);
  }
  if (session.storeganise_context.kind === 'reservation') {
    const { prepareReservationForPayment } = await import('./reservation');
    await prepareReservationForPayment(session);
    if (isLiveStoreganiseSandbox(session)) return;
  }
  if (isLiveStoreganiseSandbox(session) && (await getUser(session.customer_id)).isDisabled) {
    throw new StoreganiseIntegrationError('CUSTOMER_DISABLED', 403);
  }
  const binding = session.storeganise_context;
  if (!binding.invoiceId || !binding.rentalId || session.environment !== environment || binding.apiOrigin !== url.origin || binding.customerId !== session.customer_id ||
    binding.invoiceId !== session.invoice_id || binding.unitId !== session.unit_id) throw new StoreganiseIntegrationError('STOREGANISE_IDENTITY_MISMATCH', 403);
  const context = await invoiceContext(binding.invoiceId, binding.customerId, binding.jobId);
  assertPayable(context);
  if((context.invoice.currencyCode&&context.invoice.currencyCode!=='USD')||
    (context.invoice.currency&&context.invoice.currency!=='USD'))throw new StoreganiseIntegrationError('STOREGANISE_CURRENCY_MISMATCH');
  if (context.rental.id !== binding.rentalId || context.invoice.siteId !== binding.siteId ||
    usdAmount(context.invoice.balance) !== Number(session.reference_usd_amount).toFixed(2)) throw new StoreganiseIntegrationError('INVOICE_AMOUNT_CHANGED');
}
