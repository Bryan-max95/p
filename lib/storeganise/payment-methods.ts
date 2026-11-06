import crypto from 'node:crypto';
import { z } from 'zod';
import { query, transaction } from '../pay/db';
import { CyberSourceGateway, GatewayError } from '../cybersource/gateway';
import { billToSchema } from '../pay/billing-details';
import { assertStoreganiseEnabled, assertStoreganiseTestCustomer, StoreganiseIntegrationError } from './config';
import { getUser, sgId } from './records';
import { storeganiseGet } from './client';
import { storeganiseBookingReturn } from './browser-entry';
import { bridgeHash } from './bridge-protocol';

export interface MethodSession {
  id: string; customer_id: string; site_id: string; api_origin: string; environment: 'production' | 'sandbox';
  client_name: string; return_url: string; expires_at: Date; status: string;
  capture_context: string | null; method_id: string | null;
}
const input = z.object({ userId: sgId, siteId: sgId.optional(), returnUrl: z.string().url().optional() });

/** A missing browser hint is resolved only against the operator's real sites.
 * No arbitrary first site when the account has multiple sites. */
export async function resolveMethodOwner(value: unknown) {
  const ids = input.parse(value);
  const config = assertStoreganiseEnabled();
  assertStoreganiseTestCustomer(ids.userId);
  const user = await getUser(ids.userId);
  if (user.isDisabled) throw new StoreganiseIntegrationError('CUSTOMER_DISABLED', 403);
  const sites = z.array(z.object({ id: sgId, state: z.string().optional() }).passthrough())
    .parse(await storeganiseGet('/sites'))
    .filter(site => !['archived', 'deleted', 'disabled'].includes(site.state ?? ''));
  const configured = process.env.STOREGANISE_PAYMENT_METHOD_SITE_ID?.trim() || undefined;
  const siteId = ids.siteId ?? (configured ? sgId.parse(configured) : sites.length === 1 ? sites[0].id : undefined);
  if (!siteId) throw new StoreganiseIntegrationError('PAYMENT_SITE_REQUIRED', 409);
  if (!sites.some(site => site.id === siteId)) throw new StoreganiseIntegrationError('STOREGANISE_SITE_MISMATCH', 403);
  const target = storeganiseBookingReturn(ids.returnUrl);
  if (target && (target.pathname !== '/account/billing' || target.search || target.hash)) {
    throw new StoreganiseIntegrationError('INVALID_STOREGANISE_RETURN_URL', 403);
  }
  return { ...config, user, siteId, returnUrl: target?.href ?? new URL('/account/billing', config.url.origin).href };
}

export async function openPaymentMethodCheckout(value: unknown) {
  const owner = await resolveMethodOwner(value);
  return createMethodSession(owner);
}

export async function createMethodSession(owner: Awaited<ReturnType<typeof resolveMethodOwner>>) {
  const id = crypto.randomUUID(), token = crypto.randomBytes(32).toString('base64url');
  await query(`INSERT INTO pay_method_sessions
    (id,launch_hash,customer_id,site_id,api_origin,environment,client_name,return_url,expires_at)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,now()+interval '30 minutes')`,
  [id, bridgeHash(token), owner.user.id, owner.siteId, owner.url.origin, owner.environment,
    `${owner.user.firstName} ${owner.user.lastName}`.trim(), owner.returnUrl]);
  const url = new URL('/', process.env.PAY_PUBLIC_URL);
  url.searchParams.set('session', token);
  url.searchParams.set('flow', 'payment_method');
  return { sessionId: id, url: url.href };
}

export function publicMethodSession(session: MethodSession) {
  return { id: session.id, purpose: 'payment_method' as const, clientName: session.client_name,
    status: session.status, returnUrl: session.return_url };
}

export async function exchangeMethodToken(token: string) {
  z.string().regex(/^[A-Za-z0-9_-]{43}$/).parse(token);
  const accessToken = crypto.randomBytes(32).toString('base64url');
  const config = assertStoreganiseEnabled();
  const result = await query<MethodSession>(`UPDATE pay_method_sessions SET consumed_at=now(),access_hash=$2
    WHERE launch_hash=$1 AND consumed_at IS NULL AND expires_at>now() AND api_origin=$3 AND environment=$4 RETURNING *`,
  [bridgeHash(token), bridgeHash(accessToken), config.url.origin, config.environment]);
  if (!result.rows[0]) throw new StoreganiseIntegrationError('INVALID_OR_EXPIRED_SESSION', 401);
  return { session: result.rows[0], accessToken };
}

export async function getMethodSession(id: string, accessToken: string) {
  z.string().uuid().parse(id);
  const config = assertStoreganiseEnabled();
  const result = await query<MethodSession>(`SELECT * FROM pay_method_sessions
    WHERE id=$1 AND access_hash=$2 AND api_origin=$3 AND environment=$4 AND expires_at>now()`,
  [id, bridgeHash(accessToken), config.url.origin, config.environment]);
  if (!result.rows[0]) throw new StoreganiseIntegrationError('INVALID_OR_EXPIRED_SESSION', 401);
  return result.rows[0];
}

export async function methodCaptureContext(session: MethodSession) {
  return transaction(async client => {
    const locked = (await client.query<MethodSession>('SELECT * FROM pay_method_sessions WHERE id=$1 FOR UPDATE', [session.id])).rows[0];
    if (!locked || locked.status !== 'open' || locked.expires_at.getTime() <= Date.now()) throw new StoreganiseIntegrationError('METHOD_SESSION_NOT_OPEN');
    const gateway = new CyberSourceGateway(locked.environment);
    // Always create a fresh verified context; no token metadata is trusted from the browser.
    const context = await gateway.createCaptureContext();
    await client.query('UPDATE pay_method_sessions SET capture_context=$2 WHERE id=$1', [locked.id, context.captureContext]);
    return context;
  });
}

export async function savePaymentMethod(session: MethodSession, value: unknown) {
  const data = z.object({ token: z.string().min(100).max(20000), billTo: billToSchema }).strict().parse(value);
  // Recheck the current owner and site before token registration.
  await resolveMethodOwner({ userId: session.customer_id, siteId: session.site_id, returnUrl: session.return_url });
  const claimed = await transaction(async client => {
    const row = (await client.query<MethodSession>('SELECT * FROM pay_method_sessions WHERE id=$1 FOR UPDATE', [session.id])).rows[0];
    if (!row || row.expires_at.getTime() <= Date.now()) throw new StoreganiseIntegrationError('INVALID_OR_EXPIRED_SESSION', 401);
    if (row.status === 'saved') return { row, token: undefined };
    if (row.status !== 'open' || !row.capture_context) throw new StoreganiseIntegrationError('METHOD_REGISTRATION_PENDING');
    const token = await new CyberSourceGateway(row.environment).verifyTransientToken(data.token, row.capture_context);
    if (!token.last4 || !/^(0[1-9]|1[0-2])$/.test(token.expirationMonth ?? '') || !/^20\d{2}$/.test(token.expirationYear ?? '')) {
      throw new StoreganiseIntegrationError('INVALID_CARD_METADATA', 422);
    }
    await client.query("UPDATE pay_method_sessions SET status='registering' WHERE id=$1", [row.id]);
    return { row, token };
  });
  if (!claimed.token) return publicMethodSession(claimed.row);
  const { row, token } = claimed;
  let registered;
  try {
    registered = await new CyberSourceGateway(row.environment).registerPaymentMethod(token, `method-${row.id}`, data.billTo);
  } catch (error) {
    // An uncertain provider response must not silently start another registration.
    const definite = error instanceof GatewayError && !error.transactionId && [400, 401, 403, 404, 422].includes(error.status);
    await query('UPDATE pay_method_sessions SET status=$2 WHERE id=$1', [row.id, definite ? 'open' : 'uncertain']);
    throw new StoreganiseIntegrationError(definite ? 'PAYMENT_METHOD_PROVIDER_REJECTED' : 'METHOD_REGISTRATION_PENDING', definite ? 422 : 409);
  }
  return transaction(async client => {
    const method = await client.query<{ id: string }>(`INSERT INTO pay_saved_methods
      (id,customer_id,site_id,api_origin,environment,gateway_token,brand,last4,exp_month,exp_year,cardholder)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
      ON CONFLICT(api_origin,environment,customer_id,site_id,gateway_token) DO UPDATE SET
      brand=EXCLUDED.brand,last4=EXCLUDED.last4,exp_month=EXCLUDED.exp_month,exp_year=EXCLUDED.exp_year,cardholder=EXCLUDED.cardholder RETURNING id`,
    [crypto.randomUUID(), row.customer_id, row.site_id, row.api_origin, row.environment, registered.gatewayToken,
      token.brand, token.last4, Number(token.expirationMonth), Number(token.expirationYear), `${data.billTo.firstName} ${data.billTo.lastName}`]);
    const updated = await client.query<MethodSession>(`UPDATE pay_method_sessions SET status='saved',method_id=$2,gateway_reference=$3 WHERE id=$1 RETURNING *`,
      [row.id, method.rows[0].id, registered.transactionId]);
    return publicMethodSession(updated.rows[0]);
  });
}
