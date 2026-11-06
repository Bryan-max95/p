import crypto from 'node:crypto';
import { z } from 'zod';
import { query, transaction } from '../pay/db';
import { storeganiseGet, storeganiseRequest } from './client';
import { assertStoreganiseEnabled, StoreganiseIntegrationError } from './config';
import { BRIDGE_FIELD, BRIDGE_TTL_SECONDS, assertBridgeField, bridgeHash, bridgeToken } from './bridge-protocol';
import { createMethodSession, resolveMethodOwner } from './payment-methods';

interface Grant {
  id: string; customer_id: string; site_id: string; token_hash: string; api_origin: string;
  environment: string; expires_at: Date; client_hash: string | null; session_id: string | null;
}
function configuration() {
  if (process.env.STOREGANISE_BRIDGE_ENABLED !== 'true') throw new StoreganiseIntegrationError('STOREGANISE_BRIDGE_DISABLED', 503);
  const secret = process.env.PAY_SESSION_TOKEN_SECRET ?? '';
  if (secret.length < 32) throw new StoreganiseIntegrationError('STOREGANISE_SESSION_CONFIGURATION', 503);
  return secret;
}
export function profileDeliveries(value: unknown): Record<string, unknown>[] {
  if (typeof value !== 'string') return [];
  try {
    const parsed = z.object({ version: z.literal(1), grants: z.array(z.record(z.string(), z.unknown())) }).parse(JSON.parse(value));
    return parsed.grants.filter(grant => typeof grant.expiresAt === 'string' && Date.parse(grant.expiresAt) > Date.now());
  } catch { return []; }
}
export async function prepareMethodBridge(input: { userId: string; siteId?: string }) {
  const secret = configuration();
  const owner = await resolveMethodOwner(input);
  assertBridgeField(await storeganiseGet('/settings?include=userCustomFields'));
  await transaction(async client => {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`pay-profile-bridge:${owner.url.origin}:${owner.user.id}`]);
    const active = (await client.query<Grant>(`SELECT * FROM pay_method_bridge_grants
      WHERE api_origin=$1 AND customer_id=$2 AND environment=$3 AND client_hash IS NULL AND expires_at>now()`,
    [owner.url.origin, owner.user.id, owner.environment])).rows;
    let grant = active.find(g => g.site_id === owner.siteId && g.expires_at.getTime() > Date.now() + 30_000 &&
      g.token_hash === bridgeHash(bridgeToken(g.id, owner.url.origin, owner.environment, secret)));
    if (!grant) {
      const recent = await client.query<{ count: string }>(`SELECT count(*) FROM pay_method_bridge_grants
        WHERE api_origin=$1 AND customer_id=$2 AND created_at>now()-interval '10 minutes'`, [owner.url.origin, owner.user.id]);
      if (Number(recent.rows[0].count) >= 12) throw new StoreganiseIntegrationError('STOREGANISE_BRIDGE_RATE_LIMITED', 429);
      const id = crypto.randomUUID();
      grant = (await client.query<Grant>(`INSERT INTO pay_method_bridge_grants
        (id,token_hash,customer_id,site_id,api_origin,environment,expires_at)
        VALUES($1,$2,$3,$4,$5,$6,now()+$7*interval '1 second') RETURNING *`,
      [id, bridgeHash(bridgeToken(id, owner.url.origin, owner.environment, secret)), owner.user.id, owner.siteId,
        owner.url.origin, owner.environment, BRIDGE_TTL_SECONDS])).rows[0];
    }
    const fresh = await storeganiseGet<{ customFields?: Record<string, unknown> }>(`/users/${owner.user.id}?include=customFields`);
    const grants = profileDeliveries(fresh.customFields?.[BRIDGE_FIELD]).filter(g => g.purpose !== 'payment_method');
    grants.push({ id: grant.id, purpose: 'payment_method', siteId: grant.site_id,
      token: bridgeToken(grant.id, owner.url.origin, owner.environment, secret), expiresAt: grant.expires_at.toISOString() });
    await storeganiseRequest(`/users/${owner.user.id}`, 'PUT', { customFields: { [BRIDGE_FIELD]: JSON.stringify({ version: 1, grants }) } });
  });
  return { prepared: true as const };
}

export async function redeemMethodBridge(input: { grantId: string; token: string; clientNonce: string; siteId: string; returnUrl: string }, origin: string) {
  configuration();
  const config = assertStoreganiseEnabled();
  const target = new URL(input.returnUrl);
  if (target.origin !== origin || target.pathname !== '/account/billing' || target.search || target.hash || target.username || target.password) {
    throw new StoreganiseIntegrationError('INVALID_STOREGANISE_RETURN_URL', 403);
  }
  const grant = await transaction(async client => {
    const row = (await client.query<Grant>('SELECT * FROM pay_method_bridge_grants WHERE id=$1 FOR UPDATE', [input.grantId])).rows[0];
    const stored = Buffer.from(row?.token_hash ?? '', 'hex'), presented = Buffer.from(bridgeHash(input.token), 'hex');
    if (!row || stored.length !== presented.length || !crypto.timingSafeEqual(stored, presented) ||
      row.site_id !== input.siteId || row.api_origin !== config.url.origin || row.environment !== config.environment) {
      throw new StoreganiseIntegrationError('STOREGANISE_BRIDGE_ACCESS_INVALID', 403);
    }
    if (row.expires_at.getTime() <= Date.now()) throw new StoreganiseIntegrationError('STOREGANISE_BRIDGE_ACCESS_EXPIRED', 410);
    if (row.client_hash) throw new StoreganiseIntegrationError('STOREGANISE_BRIDGE_ACCESS_USED', 409);
    await client.query('UPDATE pay_method_bridge_grants SET client_hash=$2 WHERE id=$1', [row.id, bridgeHash(input.clientNonce)]);
    return row;
  });
  const owner = await resolveMethodOwner({ userId: grant.customer_id, siteId: grant.site_id, returnUrl: input.returnUrl });
  const result = await createMethodSession(owner);
  await query('UPDATE pay_method_bridge_grants SET session_id=$2 WHERE id=$1', [grant.id, result.sessionId]);
  return { url: result.url };
}
