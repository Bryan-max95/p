import crypto from 'node:crypto';
import { z } from 'zod';
import { transaction } from '../pay/db';
import { createCheckoutSession, requiredUrl } from '../pay/service';
import { currentBchRate, hnlCharge } from '../pay/exchange-rate';
import { billToSchema } from '../pay/billing-details';
import { needsLegacyPaymentReview } from '../pay/payment-state';
import type { SessionRow, StoreganiseContext } from '../pay/types';
import { storeganiseGet } from './client';
import { assertStoreganiseEnabled, assertStoreganiseTestCustomer, StoreganiseIntegrationError } from './config';
import { storeganiseBookingReturn } from './browser-entry';
import { invoiceReference, invoiceSchema, sgId, getUser, getRental, getJob, usdAmount } from './records';

// A service invoice can exist without a storage rental. Its API owner and site
// are authoritative; an invoice route or a browser amount is never proof.
const accountInvoiceSchema = invoiceSchema.extend({
  unitRentalId: sgId.nullish(), sid: invoiceReference.optional(),
  entries: z.array(z.object({ desc: z.string().optional() }).passthrough()).default([]),
});
export type AccountInvoice = z.infer<typeof accountInvoiceSchema>;
export const accountInvoiceStates = ['sent', 'overdue', 'failed'];

export async function getAccountInvoice(reference: string): Promise<AccountInvoice> {
  const ref = invoiceReference.parse(reference);
  const invoice = accountInvoiceSchema.parse(await storeganiseGet(`/invoices/${encodeURIComponent(ref)}`));
  if (invoice.id.toLowerCase() !== ref && invoice.sid !== ref) throw new StoreganiseIntegrationError('STOREGANISE_IDENTITY_MISMATCH', 403);
  return invoice;
}

export function assertAccountInvoiceOwner(invoice: AccountInvoice, customerId: string, siteId?: string) {
  if (invoice.owner.id !== customerId || (siteId && invoice.siteId !== siteId) || invoice.deleted) {
    throw new StoreganiseIntegrationError('STOREGANISE_IDENTITY_MISMATCH', 403);
  }
  if ((invoice.currency && invoice.currency !== 'USD') || (invoice.currencyCode && invoice.currencyCode !== 'USD')) {
    throw new StoreganiseIntegrationError('STOREGANISE_CURRENCY_MISMATCH');
  }
}

export function assertAccountInvoicePayable(invoice: AccountInvoice) {
  if (invoice.deleted || !accountInvoiceStates.includes(invoice.state) || invoice.balance <= 0 || invoice.total <= 0) {
    throw new StoreganiseIntegrationError('INVOICE_NOT_PAYABLE');
  }
  usdAmount(invoice.balance);
}

export function accountInvoiceReturn(value: string, invoice: Pick<AccountInvoice, 'id' | 'sid'>, origin?: string) {
  const target = storeganiseBookingReturn(value);
  const match = target && /^\/account\/invoices\/([a-z0-9][a-z0-9_-]{0,63})\/?$/i.exec(target.pathname);
  if (!target || !match || (origin && target.origin !== origin) || target.hash ||
    ![invoice.id.toLowerCase(), invoice.sid].includes(match[1].toLowerCase())) {
    throw new StoreganiseIntegrationError('INVALID_STOREGANISE_RETURN_URL', 403);
  }
  // Storeganise's ?pay flag can re-open its charge UI. Return to the invoice itself.
  target.search = '';
  return target.href;
}

export function assertAccountInvoiceBinding(session: SessionRow, invoice: AccountInvoice) {
  const binding = session.storeganise_context;
  if (binding?.kind !== 'account_invoice' || binding.invoiceId !== session.invoice_id || invoice.id !== binding.invoiceId ||
    binding.customerId !== session.customer_id || binding.unitId !== session.unit_id || session.unit_id !== `invoice:${invoice.id}`) {
    throw new StoreganiseIntegrationError('STOREGANISE_IDENTITY_MISMATCH', 403);
  }
  assertAccountInvoiceOwner(invoice, session.customer_id, binding.siteId);
}

export async function verifyAccountInvoiceCheckout(session: SessionRow) {
  const config = assertStoreganiseEnabled();
  if (session.environment !== config.environment || session.storeganise_context?.apiOrigin !== config.url.origin) {
    throw new StoreganiseIntegrationError('STOREGANISE_INSTANCE_ENVIRONMENT_MISMATCH');
  }
  const invoice = await getAccountInvoice(session.invoice_id ?? '');
  assertAccountInvoiceBinding(session, invoice);
  assertAccountInvoicePayable(invoice);
  if ((await getUser(session.customer_id)).isDisabled) throw new StoreganiseIntegrationError('CUSTOMER_DISABLED', 403);
  if (usdAmount(invoice.balance) !== Number(session.reference_usd_amount).toFixed(2)) throw new StoreganiseIntegrationError('INVOICE_AMOUNT_CHANGED');
}

export async function openAccountInvoiceCheckout(value: unknown) {
  const ids = z.object({ userId: sgId, invoiceId: sgId, siteId: sgId, returnUrl: z.string().url().max(2000) }).strict().parse(value);
  const { url, environment } = assertStoreganiseEnabled();
  assertStoreganiseTestCustomer(ids.userId);
  const invoice = await getAccountInvoice(ids.invoiceId);
  assertAccountInvoiceOwner(invoice, ids.userId, ids.siteId);
  const user = await getUser(ids.userId);
  if (user.isDisabled) throw new StoreganiseIntegrationError('CUSTOMER_DISABLED', 403);
  const returnUrl = accountInvoiceReturn(ids.returnUrl, invoice);
  // The first invoice of a move-in keeps the existing booking activation path.
  if (invoice.unitRentalId) {
    const rental = await getRental(invoice.unitRentalId);
    if (rental.ownerId !== user.id || rental.siteId !== invoice.siteId) throw new StoreganiseIntegrationError('STOREGANISE_IDENTITY_MISMATCH', 403);
    if (rental.moveInJobId) {
      const job = await getJob(rental.moveInJobId);
      if (job.ownerId !== user.id) throw new StoreganiseIntegrationError('STOREGANISE_IDENTITY_MISMATCH', 403);
      if (job.result.invoiceId === invoice.id) {
        const { openStoreganiseCheckout } = await import('./checkout');
        return openStoreganiseCheckout({ ...ids, returnUrl });
      }
    }
  }
  const settings = await storeganiseGet<{ currencyCode: string; manualPaymentMethods?: Array<{ code: string }> }>('/settings');
  if (settings.currencyCode !== 'USD') throw new StoreganiseIntegrationError('STOREGANISE_CURRENCY_MISMATCH');
  if (!settings.manualPaymentMethods?.some(method => method.code === (process.env.STOREGANISE_CARD_PAYMENT_METHOD ?? 'card'))) {
    throw new StoreganiseIntegrationError('STOREGANISE_CARD_METHOD_NOT_CONFIGURED', 503);
  }
  const rate = accountInvoiceStates.includes(invoice.state) && invoice.balance > 0 ? await currentBchRate() : undefined;
  const result = await transaction(async client => {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`pay-sg:${environment}:${invoice.id}`]);
    let session = (await client.query<SessionRow>('SELECT * FROM pay_sessions WHERE environment=$1 AND invoice_id=$2 FOR UPDATE', [environment, invoice.id])).rows[0];
    if (session && session.storeganise_context?.kind !== 'account_invoice') {
      // Preserve an existing reservation/invoice payment and its reconciliation.
      if (session.customer_id !== user.id || session.storeganise_context?.apiOrigin !== url.origin) throw new StoreganiseIntegrationError('STOREGANISE_IDENTITY_MISMATCH', 403);
      return { delegate: true as const };
    }
    const reference = invoice.sid?.toUpperCase() ?? invoice.id;
    const concept = invoice.entries.map(entry => entry.desc?.trim()).filter(Boolean).slice(0, 4).join(' · ').slice(0, 300) || `Factura ${reference}`;
    if (session) {
      assertAccountInvoiceBinding(session, invoice);
      if (['open', 'declined'].includes(session.status) && !needsLegacyPaymentReview(session)) {
        assertAccountInvoicePayable(invoice);
        const amount = usdAmount(invoice.balance);
        if (session.expires_at.getTime() <= Date.now() || session.currency !== 'HNL' || Number(session.reference_usd_amount).toFixed(2) !== amount) {
          if (!rate) throw new StoreganiseIntegrationError('EXCHANGE_RATE_UNAVAILABLE', 503);
          session = (await client.query<SessionRow>(`UPDATE pay_sessions SET reference_usd_amount=$2,amount=$3,currency='HNL',
            usd_hnl_rate=$4,fx_source='BCH',fx_rate_date=$5,fx_fetched_at=$6,fx_indicator_id=$7,
            capture_context=NULL,expires_at=now()+interval '30 minutes',updated_at=now() WHERE id=$1 RETURNING *`,
          [session.id, amount, hnlCharge(amount, rate.hnlPerUsd), rate.hnlPerUsd, rate.rateDate, rate.fetchedAt, rate.indicatorId])).rows[0];
        }
      }
      await client.query('UPDATE pay_sessions SET return_url=$2,updated_at=now() WHERE id=$1', [session.id, returnUrl]);
    } else {
      assertAccountInvoicePayable(invoice);
      const binding: StoreganiseContext = { kind: 'account_invoice', apiOrigin: url.origin, customerId: user.id,
        invoiceId: invoice.id, siteId: invoice.siteId, unitId: `invoice:${invoice.id}`, invoiceReference: reference };
      const billing = billToSchema.safeParse(user.customFields?.pay_billTo);
      const created = await createCheckoutSession({ eventId: `storeganise-${environment}-${invoice.id}`, customerId: user.id,
        invoiceId: invoice.id, unitId: binding.unitId, clientName: user.name ?? `${user.firstName} ${user.lastName}`,
        unitName: reference, concept, amount: usdAmount(invoice.balance), currency: 'USD', environment, source: 'storeganise',
        isTest: environment === 'sandbox', fiscalEnvironment: environment === 'sandbox' ? 'test' : 'production', payable: true,
        returnUrl, storeganiseContext: binding, billTo: billing.success ? billing.data : {
          firstName: user.firstName, lastName: user.lastName, email: user.email, address1: user.address ?? '', locality: '', postalCode: '', country: '',
        } }, { client, rate });
      session = (await client.query<SessionRow>('SELECT * FROM pay_sessions WHERE id=$1', [created.id])).rows[0];
    }
    const token = crypto.randomBytes(32).toString('base64url');
    await client.query("DELETE FROM pay_launch_links WHERE session_id=$1 AND expires_at<now()", [session.id]);
    await client.query("INSERT INTO pay_launch_links(token_hash,session_id,expires_at) VALUES($1,$2,now()+interval '10 minutes')",
      [crypto.createHash('sha256').update(token).digest('hex'), session.id]);
    return { sessionId: session.id, url: `${requiredUrl('PAY_PUBLIC_URL')}/?session=${token}` };
  });
  if ('delegate' in result) {
    const { openStoreganiseCheckout } = await import('./checkout');
    return openStoreganiseCheckout({ ...ids, returnUrl });
  }
  return result;
}
