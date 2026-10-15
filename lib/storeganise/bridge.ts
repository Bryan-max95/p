import crypto from 'node:crypto';
import type { z } from 'zod';
import { query, transaction } from '../pay/db';
import { assertStoreganiseEnabled, assertStoreganiseTestCustomer, StoreganiseIntegrationError } from './config';
import { storeganiseGet, storeganiseRequest } from './client';
import { getJob, getUser, assertOrderActive } from './records';
import { matchingOrderId, storeganiseBookingReturn } from './browser-entry';
import { openVerifiedReservationCheckout } from './reservation';
import { BRIDGE_FIELD, BRIDGE_TTL_SECONDS, BRIDGE_MAX_OPEN_ORDERS, bridgeHash, bridgeToken,
  assertBridgeField, assertBridgeProof, type BridgeGrant, type bridgeInput } from './bridge-protocol';

function configuration() {
  if (process.env.STOREGANISE_BRIDGE_ENABLED !== 'true') throw new StoreganiseIntegrationError('STOREGANISE_BRIDGE_DISABLED', 503);
  const result = assertStoreganiseEnabled();
  const secret = process.env.PAY_SESSION_TOKEN_SECRET ?? '';
  if (secret.length < 32) throw new StoreganiseIntegrationError('STOREGANISE_SESSION_CONFIGURATION', 503);
  return { ...result, secret };
}

/** Limits anonymous provisioning as well as redemption. Origin/CORS is not authentication. */
export async function limitBridgeRequests(ip: string) {
  const { secret } = configuration();
  const key = crypto.createHmac('sha256', secret).update(`pay/profile-bridge/ip:${ip}`).digest('hex');
  const result = await query<{ attempts: number }>(`INSERT INTO pay_customer_login_limits(key_hash,attempts,expires_at)
    VALUES($1,1,now()+interval '1 minute') ON CONFLICT(key_hash) DO UPDATE SET
    attempts=CASE WHEN pay_customer_login_limits.expires_at<now() THEN 1 ELSE pay_customer_login_limits.attempts+1 END,
    expires_at=CASE WHEN pay_customer_login_limits.expires_at<now() THEN now()+interval '1 minute' ELSE pay_customer_login_limits.expires_at END
    RETURNING attempts`, [key]);
  if (result.rows[0].attempts > 20) throw new StoreganiseIntegrationError('STOREGANISE_BRIDGE_RATE_LIMITED', 429);
}

/** Public initiation conveys hints only. Its response MUST NOT contain an access
 * code, a Pay URL, customer details or a price. The grant goes exclusively to the
 * owner's Storeganise profile, readable with that customer's native session.
 */
export async function prepareProfileBridge(input: Extract<z.infer<typeof bridgeInput>, { operation: 'prepare' }>) {
  const { url, environment, secret } = configuration();
  assertStoreganiseTestCustomer(input.userId);
  const job = await getJob(input.orderId);
  if (job.type !== 'unit_moveIn' || job.ownerId !== input.userId) throw new StoreganiseIntegrationError('STOREGANISE_BRIDGE_ACCESS_INVALID', 403);
  assertOrderActive(job);
  const user = await getUser(job.ownerId);
  if (user.isDisabled) throw new StoreganiseIntegrationError('CUSTOMER_DISABLED', 403);
  assertBridgeField(await storeganiseGet('/settings?include=userCustomFields'));

  await transaction(async client => {
    // Different orders for one owner must not overwrite each other's delivery.
    // No nested database transaction or checkout/network price lookup under this lock.
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`pay-profile-bridge:${url.origin}:${user.id}`]);
    const active = (await client.query<BridgeGrant>(`SELECT * FROM pay_storeganise_bridge_grants
      WHERE api_origin=$1 AND customer_id=$2 AND environment=$3 AND client_hash IS NULL AND expires_at>now()
      ORDER BY expires_at`, [url.origin, user.id, environment])).rows;
    const current = active.filter(grant => grant.token_hash === bridgeHash(bridgeToken(grant.id, url.origin, environment, secret)));
    let grant = current.find(item => item.order_id === job.id && item.expires_at.getTime() > Date.now() + 30_000);
    if (!grant) {
      const recent = await client.query<{ count: string }>(`SELECT count(*) FROM pay_storeganise_bridge_grants
        WHERE api_origin=$1 AND customer_id=$2 AND created_at>now()-interval '10 minutes'`, [url.origin, user.id]);
      if (Number(recent.rows[0].count) >= 12) throw new StoreganiseIntegrationError('STOREGANISE_BRIDGE_RATE_LIMITED', 429);
      if (current.filter(item => item.order_id !== job.id).length >= BRIDGE_MAX_OPEN_ORDERS) {
        throw new StoreganiseIntegrationError('STOREGANISE_BRIDGE_TOO_MANY_ORDERS', 429);
      }
      await client.query(`UPDATE pay_storeganise_bridge_grants SET expires_at=now()
        WHERE api_origin=$1 AND customer_id=$2 AND order_id=$3 AND client_hash IS NULL`, [url.origin, user.id, job.id]);
      const id = crypto.randomUUID();
      grant = (await client.query<BridgeGrant>(`INSERT INTO pay_storeganise_bridge_grants
        (id,token_hash,customer_id,order_id,api_origin,environment,expires_at)
        VALUES($1,$2,$3,$4,$5,$6,now()+$7*interval '1 second') RETURNING *`,
      [id, bridgeHash(bridgeToken(id, url.origin, environment, secret)), user.id, job.id, url.origin, environment, BRIDGE_TTL_SECONDS])).rows[0];
    }
    const grants = [...current.filter(item => item.order_id !== job.id), grant].map(item => ({
      id: item.id, orderId: item.order_id, token: bridgeToken(item.id, url.origin, environment, secret), expiresAt: item.expires_at.toISOString(),
    }));
    // A partial customFields update preserves the customer's other fields.
    // This is the sole Storeganise write made by the bridge. No order is submitted.
    const delivery = JSON.stringify({ version: 1, grants });
    if (user.customFields?.[BRIDGE_FIELD] !== delivery) {
      await storeganiseRequest(`/users/${user.id}`, 'PUT', { customFields: { [BRIDGE_FIELD]: delivery } });
    }
  });
  return { prepared: true as const };
}

export async function redeemProfileBridge(input: Extract<z.infer<typeof bridgeInput>, { operation: 'redeem' }>, origin: string) {
  const { url, environment } = configuration();
  const returnUrl = storeganiseBookingReturn(input.returnUrl);
  if (!returnUrl || returnUrl.origin !== origin || returnUrl.hash || returnUrl.searchParams.getAll('orderId').length > 1) {
    throw new StoreganiseIntegrationError('INVALID_STOREGANISE_RETURN_URL', 403);
  }
  matchingOrderId(input.orderId, returnUrl.searchParams.get('orderId'));
  const expected = { apiOrigin: url.origin, environment };
  const lease = crypto.randomUUID();
  const grant = await transaction(async client => {
    const record = (await client.query<BridgeGrant>('SELECT * FROM pay_storeganise_bridge_grants WHERE id=$1 FOR UPDATE', [input.grantId])).rows[0];
    assertBridgeProof(record, input, expected);
    assertStoreganiseTestCustomer(record.customer_id);
    if (record.lease_until && record.lease_until.getTime() > Date.now()) throw new StoreganiseIntegrationError('STOREGANISE_BRIDGE_BUSY', 409);
    await client.query(`UPDATE pay_storeganise_bridge_grants SET client_hash=$2,lease_token=$3,
      lease_until=now()+interval '90 seconds' WHERE id=$1`, [record.id, bridgeHash(input.clientNonce), lease]);
    return record;
  });
  try {
    // Token possession, not the browser's userId, authorizes this lookup. The
    // existing resolver rechecks the current job owner, site, unit and amount.
    const result = await openVerifiedReservationCheckout({ userId: grant.customer_id,
      orderId: grant.order_id, returnUrl: returnUrl.href }, 'profile-bridge');
    const updated = await query(`UPDATE pay_storeganise_bridge_grants SET session_id=$2,lease_token=NULL,lease_until=NULL
      WHERE id=$1 AND lease_token=$3 RETURNING id`, [grant.id, result.sessionId, lease]);
    if (!updated.rowCount) throw new StoreganiseIntegrationError('STOREGANISE_BRIDGE_BUSY', 409);
    // Same-tab retries retain their clientNonce; another browser cannot redeem
    // this grant after its first claim. Every returned launch token is single-use.
    return { url: result.url };
  } catch (error) {
    await query('UPDATE pay_storeganise_bridge_grants SET lease_token=NULL,lease_until=NULL WHERE id=$1 AND lease_token=$2', [grant.id, lease]);
    throw error;
  }
}
