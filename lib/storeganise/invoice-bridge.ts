import crypto from 'node:crypto';
import type { z } from 'zod';
import { query, transaction } from '../pay/db';
import { storeganiseGet, storeganiseRequest } from './client';
import { assertStoreganiseEnabled, assertStoreganiseTestCustomer, StoreganiseIntegrationError } from './config';
import { BRIDGE_FIELD, BRIDGE_TTL_SECONDS, assertBridgeField, bridgeHash, bridgeToken, type bridgeInput } from './bridge-protocol';
import { getUser } from './records';
import { profileDeliveries } from './payment-method-bridge';
import { accountInvoiceReturn, assertAccountInvoiceOwner, assertAccountInvoicePayable, getAccountInvoice, openAccountInvoiceCheckout } from './invoice-checkout';

export interface InvoiceGrant {
  id: string; customer_id: string; invoice_id: string; invoice_ref: string; site_id: string;
  token_hash: string; api_origin: string; environment: string; expires_at: Date;
  client_hash: string | null; session_id: string | null; lease_token: string | null; lease_until: Date | null;
}
function configuration() {
  if (process.env.STOREGANISE_BRIDGE_ENABLED !== 'true') throw new StoreganiseIntegrationError('STOREGANISE_BRIDGE_DISABLED', 503);
  const secret = process.env.PAY_SESSION_TOKEN_SECRET ?? '';
  if (secret.length < 32) throw new StoreganiseIntegrationError('STOREGANISE_SESSION_CONFIGURATION', 503);
  return { ...assertStoreganiseEnabled(), secret };
}

// As with reservations, the public prepare response never contains the token.
// Only the invoice owner's authenticated, read-only profile receives it.
export async function prepareInvoiceBridge(input: Extract<z.infer<typeof bridgeInput>, { operation: 'prepare_invoice' }>) {
  const { url, environment, secret } = configuration();
  assertStoreganiseTestCustomer(input.userId);
  const invoice = await getAccountInvoice(input.invoiceRef);
  assertAccountInvoiceOwner(invoice, input.userId, input.siteId);
  assertAccountInvoicePayable(invoice);
  const user = await getUser(input.userId);
  if (user.isDisabled) throw new StoreganiseIntegrationError('CUSTOMER_DISABLED', 403);
  assertBridgeField(await storeganiseGet('/settings?include=userCustomFields'));
  await transaction(async client => {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`pay-profile-bridge:${url.origin}:${user.id}`]);
    const active = (await client.query<InvoiceGrant>(`SELECT * FROM pay_invoice_bridge_grants
      WHERE api_origin=$1 AND customer_id=$2 AND environment=$3 AND client_hash IS NULL AND expires_at>now()`,
    [url.origin, user.id, environment])).rows;
    const current = active.filter(g => g.token_hash === bridgeHash(bridgeToken(g.id, url.origin, environment, secret)));
    let grant = current.find(g => g.invoice_id === invoice.id && g.invoice_ref === input.invoiceRef && g.site_id === invoice.siteId && g.expires_at.getTime() > Date.now() + 30_000);
    if (!grant) {
      const recent = await client.query<{ count: string }>(`SELECT count(*) FROM pay_invoice_bridge_grants
        WHERE api_origin=$1 AND customer_id=$2 AND created_at>now()-interval '10 minutes'`, [url.origin, user.id]);
      if (Number(recent.rows[0].count) >= 12) throw new StoreganiseIntegrationError('STOREGANISE_BRIDGE_RATE_LIMITED', 429);
      if (current.filter(g => g.invoice_id !== invoice.id).length >= 3) throw new StoreganiseIntegrationError('STOREGANISE_BRIDGE_TOO_MANY_INVOICES', 429);
      await client.query(`UPDATE pay_invoice_bridge_grants SET expires_at=now()
        WHERE api_origin=$1 AND customer_id=$2 AND invoice_id=$3 AND client_hash IS NULL`, [url.origin, user.id, invoice.id]);
      const id = crypto.randomUUID();
      grant = (await client.query<InvoiceGrant>(`INSERT INTO pay_invoice_bridge_grants
        (id,token_hash,customer_id,invoice_id,invoice_ref,site_id,api_origin,environment,expires_at)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,now()+$9*interval '1 second') RETURNING *`,
      [id, bridgeHash(bridgeToken(id, url.origin, environment, secret)), user.id, invoice.id, input.invoiceRef,
        invoice.siteId, url.origin, environment, BRIDGE_TTL_SECONDS])).rows[0];
    }
    const fresh = await getUser(user.id);
    const grants = profileDeliveries(fresh.customFields?.[BRIDGE_FIELD]).filter(g => g.purpose !== 'invoice');
    for (const item of [...current.filter(g => g.invoice_id !== invoice.id), grant]) {
      grants.push({ id: item.id, purpose: 'invoice', invoiceRef: item.invoice_ref, siteId: item.site_id,
        token: bridgeToken(item.id, url.origin, environment, secret), expiresAt: item.expires_at.toISOString() });
    }
    const delivery = JSON.stringify({ version: 1, grants });
    if (delivery.length > 4096) throw new StoreganiseIntegrationError('STOREGANISE_BRIDGE_TOO_MANY_INVOICES', 429);
    if (fresh.customFields?.[BRIDGE_FIELD] !== delivery) {
      await storeganiseRequest(`/users/${user.id}`, 'PUT', { customFields: { [BRIDGE_FIELD]: delivery } });
    }
  });
  return { prepared: true as const };
}

type Redeem = Extract<z.infer<typeof bridgeInput>, { operation: 'redeem_invoice' }>;
export function assertInvoiceBridgeProof(row: InvoiceGrant | undefined, input: Redeem,
  expected: { apiOrigin: string; environment: string }, now = Date.now()) {
  const stored = Buffer.from(row?.token_hash ?? '', 'hex'), presented = Buffer.from(bridgeHash(input.token), 'hex');
  if (!row || stored.length !== presented.length || !crypto.timingSafeEqual(stored, presented) ||
    row.invoice_ref !== input.invoiceRef || row.site_id !== input.siteId ||
    row.api_origin !== expected.apiOrigin || row.environment !== expected.environment) {
    throw new StoreganiseIntegrationError('STOREGANISE_BRIDGE_ACCESS_INVALID', 403);
  }
  if (row.expires_at.getTime() <= now) throw new StoreganiseIntegrationError('STOREGANISE_BRIDGE_ACCESS_EXPIRED', 410);
  if (row.client_hash && row.client_hash !== bridgeHash(input.clientNonce)) throw new StoreganiseIntegrationError('STOREGANISE_BRIDGE_ACCESS_USED', 409);
}

export async function redeemInvoiceBridge(input: Redeem, origin: string) {
  const { url, environment } = configuration();
  const lease = crypto.randomUUID();
  const grant = await transaction(async client => {
    const row = (await client.query<InvoiceGrant>('SELECT * FROM pay_invoice_bridge_grants WHERE id=$1 FOR UPDATE', [input.grantId])).rows[0];
    assertInvoiceBridgeProof(row, input, { apiOrigin: url.origin, environment });
    assertStoreganiseTestCustomer(row.customer_id);
    accountInvoiceReturn(input.returnUrl, { id: row.invoice_id, sid: row.invoice_ref }, origin);
    if (row.lease_until && row.lease_until.getTime() > Date.now()) throw new StoreganiseIntegrationError('STOREGANISE_BRIDGE_BUSY', 409);
    await client.query(`UPDATE pay_invoice_bridge_grants SET client_hash=$2,lease_token=$3,
      lease_until=now()+interval '90 seconds' WHERE id=$1`, [row.id, bridgeHash(input.clientNonce), lease]);
    return row;
  });
  try {
    const result = await openAccountInvoiceCheckout({ userId: grant.customer_id, invoiceId: grant.invoice_id,
      siteId: grant.site_id, returnUrl: input.returnUrl });
    const updated = await query(`UPDATE pay_invoice_bridge_grants SET session_id=$2,lease_token=NULL,lease_until=NULL
      WHERE id=$1 AND lease_token=$3 RETURNING id`, [grant.id, result.sessionId, lease]);
    if (!updated.rowCount) throw new StoreganiseIntegrationError('STOREGANISE_BRIDGE_BUSY', 409);
    return { url: result.url };
  } catch (error) {
    await query('UPDATE pay_invoice_bridge_grants SET lease_token=NULL,lease_until=NULL WHERE id=$1 AND lease_token=$2', [grant.id, lease]).catch(() => undefined);
    throw error;
  }
}
