import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { NextRequest } from 'next/server';
import { database, closeDatabase } from '../lib/pay/db';
import { bridgeInput, bridgeToken, bridgeHash, assertBridgeField, assertBridgeProof, BRIDGE_FIELD, type BridgeGrant } from '../lib/storeganise/bridge-protocol';
import { prepareProfileBridge, redeemProfileBridge } from '../lib/storeganise/bridge';
import { prepareReservationForPayment } from '../lib/storeganise/reservation';
import { publicSession } from '../lib/pay/service';
import { OPTIONS, POST } from '../app/api/storeganise/bridge/route';
import type { SessionRow } from '../lib/pay/types';

const owner = '100000000000000000000001', other = '100000000000000000000002';
const orderId = '200000000000000000000001', siteId = '300000000000000000000001';
const typeId = '400000000000000000000001', unitId = '500000000000000000000001';
const invoiceId = '600000000000000000000001', rentalId = '700000000000000000000001';
const origin = 'https://roatanselfstorage.storeganise.com', booking = 'https://booking.roatanselfstorage.com';
const field = { code: BRIDGE_FIELD, type: 'string', ownerAcl: 'read', required: false, secret: false, multiple: false, enum: [] };
const secret = 'isolated-unit-test-secret-more-than-32-characters';
const nonce = () => crypto.randomBytes(32).toString('base64url');

/** All provider and DB boundaries are in memory. No live customers, credentials,
 * invoices, payments or database migrations are accessed by these tests. */
function fixture(t: TestContext) {
  const env = { DATABASE_URL: 'postgresql://test:test@127.0.0.1:1/unused', BCH_API_KEY: 'unit-test-only',
    CYBERSOURCE_ENVIRONMENT: 'production', CYBERSOURCE_MERCHANT_ID: 'unit-test-merchant',
    CYBERSOURCE_KEY_ID: crypto.randomUUID(), CYBERSOURCE_SHARED_SECRET: Buffer.alloc(32, 8).toString('base64'),
    STOREGANISE_PAY_ENABLED: 'true', STOREGANISE_BRIDGE_ENABLED: 'true', STOREGANISE_API_URL: origin + '/api/v1/admin',
    STOREGANISE_API_KEY: 'unit-test-private-key', PAY_SESSION_TOKEN_SECRET: secret,
    PAY_PUBLIC_URL: 'https://www.payroatanselfstorage.com' };
  const previous = Object.fromEntries(Object.keys(env).map(key => [key, process.env[key]]));
  Object.assign(process.env, env);
  const grants = new Map<string, BridgeGrant>();
  const sessions = new Map<string, SessionRow>();
  const deliveries: Record<string, unknown>[] = [];
  const requests: Array<{ path: string; method: string }> = [];
  const state = { owner, invoice: false, orderState: 'notSubmitted', field: { ...field },
    customFields: { unrelated: 'preserve me' } as Record<string, unknown>, providerStatus: 200, attempts: 0, releaseCalls: 0 };
  const runQuery = async (sql: string, values: unknown[] = []) => {
    let rows: unknown[] = [];
    if (sql.startsWith('INSERT INTO pay_customer_login_limits')) rows = [{ attempts: ++state.attempts }];
    else if (sql.startsWith('SELECT count(*) FROM pay_storeganise_bridge_grants')) rows = [{ count: String(grants.size) }];
    else if (sql.startsWith('SELECT * FROM pay_storeganise_bridge_grants WHERE id=')) rows = grants.has(String(values[0])) ? [grants.get(String(values[0]))!] : [];
    else if (sql.startsWith('SELECT * FROM pay_storeganise_bridge_grants')) rows = [...grants.values()].filter(g => g.api_origin === values[0] && g.customer_id === values[1] && g.environment === values[2] && !g.client_hash && g.expires_at.getTime() > Date.now());
    else if (sql.startsWith('INSERT INTO pay_storeganise_bridge_grants')) {
      const g: BridgeGrant = { id: String(values[0]), token_hash: String(values[1]), customer_id: String(values[2]),
        order_id: String(values[3]), api_origin: String(values[4]), environment: String(values[5]),
        expires_at: new Date(Date.now() + Number(values[6]) * 1000), client_hash: null, lease_token: null, lease_until: null, session_id: null };
      grants.set(g.id, g); rows = [g];
    } else if (sql.startsWith('UPDATE pay_storeganise_bridge_grants SET expires_at=')) {
      for (const g of grants.values()) if (g.api_origin === values[0] && g.customer_id === values[1] && g.order_id === values[2] && !g.client_hash) g.expires_at = new Date();
    } else if (sql.startsWith('UPDATE pay_storeganise_bridge_grants SET client_hash=')) {
      const g = grants.get(String(values[0]))!; g.client_hash = String(values[1]); g.lease_token = String(values[2]); g.lease_until = new Date(Date.now() + 90_000);
    } else if (sql.startsWith('UPDATE pay_storeganise_bridge_grants SET session_id=')) {
      const g = grants.get(String(values[0]))!;
      if (g.lease_token === values[2]) { g.session_id = String(values[1]); g.lease_token = null; g.lease_until = null; rows = [g]; }
    } else if (sql.startsWith('UPDATE pay_storeganise_bridge_grants SET lease_token=')) {
      const g = grants.get(String(values[0]))!;
      if (g.lease_token === values[1]) { g.lease_token = null; g.lease_until = null; }
    } else if (sql.startsWith('SELECT rate FROM pay_exchange_rates')) {
      rows = [{ rate: { source: 'BCH', indicatorId: 97, hnlPerUsd: '26.500000',
        rateDate: new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Tegucigalpa' }).format(new Date()), fetchedAt: new Date().toISOString() } }];
    } else if (sql.startsWith('SELECT * FROM pay_sessions WHERE event_id=')) rows = [...sessions.values()].filter(s => s.event_id === values[0]);
    else if (sql.startsWith('SELECT * FROM pay_sessions WHERE environment=')) rows = [...sessions.values()].filter(s => s.environment === values[0] && (s.invoice_id === values[1] || s.event_id === values[2]));
    else if (sql.startsWith('SELECT * FROM pay_sessions WHERE id=')) rows = sessions.has(String(values[0])) ? [sessions.get(String(values[0]))!] : [];
    else if (sql.startsWith('SELECT id FROM pay_sessions')) rows = [];
    else if (sql.startsWith('INSERT INTO pay_sessions')) {
      const s = { id: String(values[0]), event_id: String(values[1]), customer_id: String(values[3]), order_id: values[4], invoice_id: values[5],
        unit_id: String(values[6]), client_name: String(values[7]), unit_name: String(values[8]), concept: String(values[9]),
        currency: String(values[10]), amount: String(values[11]), bill_to: JSON.parse(String(values[12])), return_url: values[13],
        is_demo: values[14], reference_usd_amount: values[16], usd_hnl_rate: values[17], fx_source: values[18],
        fx_rate_date: values[19], fx_fetched_at: new Date(String(values[20])), environment: values[21], checkout_source: values[22],
        storeganise_context: JSON.parse(String(values[23])), status: 'open', created_at: new Date(), expires_at: new Date(Date.now() + 1800000),
      } as SessionRow;
      sessions.set(s.id, s); rows = [s];
    } else if (sql.startsWith('UPDATE pay_sessions SET return_url=')) sessions.get(String(values[0]))!.return_url = String(values[1]);
    else if (sql.startsWith('INSERT INTO pay_launch_links') || sql.startsWith('DELETE FROM pay_launch_links')) { /* no bank action */ }
    else if (!['BEGIN', 'COMMIT', 'ROLLBACK'].includes(sql) && !sql.includes('pg_advisory_xact_lock') && !sql.includes('CREATE TABLE IF NOT EXISTS')) throw new Error(`Unhandled query: ${sql}`);
    return { rows: structuredClone(rows), rowCount: rows.length };
  };
  const pool = database();
  t.mock.method(pool, 'query', runQuery);
  t.mock.method(pool, 'connect', async () => ({ query: runQuery, release() { state.releaseCalls++; } }));
  t.mock.method(globalThis, 'fetch', async (url: string | URL | Request, init?: RequestInit) => {
    const target = new URL(String(url));
    assert.equal(target.origin, origin, 'No bank, BCH or unrelated host request');
    const path = target.pathname.replace('/api/v1/admin', '');
    const method = init?.method ?? 'GET'; requests.push({ path, method });
    if (state.providerStatus !== 200) return new Response('private provider failure', { status: state.providerStatus });
    let body: unknown;
    if (path === `/jobs/${orderId}` && method === 'GET') body = { id: orderId, ownerId: state.owner, type: 'unit_moveIn', state: 'ready', steps: [],
      result: { siteId, unitTypeId: typeId, startDate: '2026-10-30', orderState: state.orderState,
        ...(state.invoice ? { invoiceId, unitRentalId: rentalId, unitId } : {}) } };
    else if (path === `/jobs/${orderId}/operations/previewInvoice` && method === 'POST') body = { total: 199 };
    else if (path === `/users/${owner}` && method === 'GET') body = { id: owner, firstName: 'Test', lastName: 'Customer', email: 'customer@example.test', customFields: state.customFields };
    else if (path === `/users/${owner}` && method === 'PUT') {
      const update = JSON.parse(String(init?.body)); deliveries.push(update);
      Object.assign(state.customFields, update.customFields); body = {};
    } else if (path === '/settings') body = { currencyCode: 'USD', manualPaymentMethods: [{ code: 'card' }], userCustomFields: [state.field] };
    else if (path === `/unit-types/${typeId}`) body = { id: typeId, title: { en: 'Hallway Medium' } };
    else if (path === `/invoices/${invoiceId}`) body = { id: invoiceId, owner: { id: owner }, unitRentalId: rentalId, siteId, state: 'sent', balance: 199, total: 199, currency: 'USD', payments: [] };
    else if (path === `/unit-rentals/${rentalId}`) body = { id: rentalId, ownerId: owner, siteId, unitId, state: 'active', moveInJobId: orderId };
    else if (path === `/units/${unitId}`) body = { id: unitId, siteId, name: 'H-01', state: 'reserved', ownerId: owner, rentalId };
    else throw new Error(`Unexpected provider call: ${method} ${path}`);
    return Response.json(body);
  });
  t.after(async () => {
    await closeDatabase();
    for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  });
  const deliveredInput = () => {
    const grant = JSON.parse(String(state.customFields[BRIDGE_FIELD])).grants[0];
    return { operation: 'redeem' as const, grantId: grant.id as string, token: grant.token as string,
      clientNonce: nonce(), orderId, returnUrl: `${booking}/sites/roatan/h-medium?orderId=${orderId}&step=billing` };
  };
  return { state, grants, sessions, requests, deliveries, deliveredInput };
}

test('bridge field must be unique, readable and not editable by the customer', () => {
  assert.doesNotThrow(() => assertBridgeField({ userCustomFields: [field, { code: 'other', type: 'array', enum: {} }] }));
  for (const bad of [{ ownerAcl: '' }, { ownerAcl: 'read,create' }, { ownerAcl: 'read,create,update' },
    { required: true }, { secret: true }, { multiple: true }, { maxLength: 20 }, { minLength: 1 }, { type: 'number' }, { enum: ['x'] }]) {
    assert.throws(() => assertBridgeField({ userCustomFields: [{ ...field, ...bad }] }), /FIELD_NOT_CONFIGURED/);
  }
  assert.throws(() => assertBridgeField({ userCustomFields: [field, field] }), /FIELD_NOT_CONFIGURED/);
});

test('grant proofs reject forgery, expiry, cross-order/environment and another browser', () => {
  const id = crypto.randomUUID(), token = bridgeToken(id, origin, 'production', secret), clientNonce = nonce();
  const grant: BridgeGrant = { id, token_hash: bridgeHash(token), customer_id: owner, order_id: orderId,
    api_origin: origin, environment: 'production', expires_at: new Date(Date.now() + 10000),
    client_hash: null, lease_token: null, lease_until: null, session_id: null };
  const expected = { apiOrigin: origin, environment: 'production' };
  assertBridgeProof(grant, { token, clientNonce, orderId }, expected);
  assert.notEqual(token, bridgeToken(id, origin, 'sandbox', secret));
  for (const input of [{ token: nonce(), clientNonce, orderId }, { token, clientNonce, orderId: other }]) {
    assert.throws(() => assertBridgeProof(grant, input, expected), /ACCESS_INVALID/);
  }
  assert.throws(() => assertBridgeProof(grant, { token, clientNonce, orderId }, { ...expected, apiOrigin: 'https://other.storeganise.com' }), /ACCESS_INVALID/);
  assert.throws(() => assertBridgeProof(grant, { token, clientNonce, orderId }, { ...expected, environment: 'sandbox' }), /ACCESS_INVALID/);
  assert.throws(() => assertBridgeProof({ ...grant, expires_at: new Date(0) }, { token, clientNonce, orderId }, expected), /ACCESS_EXPIRED/);
  assertBridgeProof({ ...grant, client_hash: bridgeHash(clientNonce) }, { token, clientNonce, orderId }, expected);
  assert.throws(() => assertBridgeProof({ ...grant, client_hash: bridgeHash(nonce()) }, { token, clientNonce, orderId }, expected), /ACCESS_USED/);
  assert.equal(bridgeInput.safeParse({ operation: 'prepare', userId: owner, orderId, amount: '1.00' }).success, false);
});

test('anonymous prepare delivers no access in response; reuses private delivery and preserves fields', async t => {
  const f = fixture(t);
  const first = await prepareProfileBridge({ operation: 'prepare', userId: owner, orderId });
  assert.deepEqual(first, { prepared: true });
  assert.equal(f.grants.size, 1); assert.equal(f.deliveries.length, 1);
  assert.equal(f.state.customFields.unrelated, 'preserve me');
  assert.deepEqual(Object.keys(f.deliveries[0]), ['customFields']);
  const delivered = f.deliveredInput();
  assert.equal(f.grants.get(delivered.grantId)!.token_hash, bridgeHash(delivered.token));
  assert.equal(JSON.stringify(first).includes(delivered.token), false);
  assert.deepEqual(await prepareProfileBridge({ operation: 'prepare', userId: owner, orderId }), first);
  assert.equal(f.grants.size, 1); assert.equal(f.deliveries.length, 1, 'Repeated clicks do not cause repeated profile writes');
  assert.equal(f.sessions.size, 0);
});

test('foreign reservation, inactive order and insecure field never receive grants', async t => {
  const f = fixture(t);
  await assert.rejects(prepareProfileBridge({ operation: 'prepare', userId: other, orderId }), /ACCESS_INVALID/);
  f.state.orderState = 'abandoned';
  await assert.rejects(prepareProfileBridge({ operation: 'prepare', userId: owner, orderId }), /ORDER_NOT_ACTIVE/);
  f.state.orderState = 'notSubmitted'; f.state.field.ownerAcl = 'read,create,update';
  await assert.rejects(prepareProfileBridge({ operation: 'prepare', userId: owner, orderId }), /FIELD_NOT_CONFIGURED/);
  assert.equal(f.grants.size, 0); assert.equal(f.deliveries.length, 0);
});

test('private profile proof opens the correct draft carousel without invoice or second login', async t => {
  const f = fixture(t);
  await prepareProfileBridge({ operation: 'prepare', userId: owner, orderId });
  const input = f.deliveredInput();
  const result = await redeemProfileBridge(input, booking);
  assert.match(result.url, /^https:\/\/www\.payroatanselfstorage\.com\/\?session=[A-Za-z0-9_-]{43}$/);
  assert.equal(f.sessions.size, 1);
  const session = [...f.sessions.values()][0];
  assert.equal(session.customer_id, owner); assert.equal(session.order_id, orderId);
  assert.equal(session.reference_usd_amount, '199.00'); assert.equal(session.amount, '5273.50');
  assert.equal(session.unit_id, typeId); assert.equal(session.invoice_id, null);
  assert.equal(session.storeganise_context?.reservationAuthentication, 'profile-bridge');
  assert.equal(publicSession(session).requiresReservationConfirmation, false);
  assert.equal(f.requests.some(r => /billing\/custom|login|submit|cybersource/.test(r.path)), false);
  assert.equal(f.requests.filter(r => r.method === 'PUT').length, 1, 'Only the profile field is updated');
  await assert.rejects(prepareReservationForPayment(session), /STOREGANISE_RESERVATION_PENDING/);
  await assert.rejects(redeemProfileBridge({ ...input, clientNonce: nonce() }, booking), /ACCESS_USED/);
  const retry = await redeemProfileBridge(input, booking);
  assert.notEqual(retry.url, result.url); assert.equal(f.sessions.size, 1, 'Same browser reuses the reservation, not a second payment');
});

test('confirmed invoice uses exact ledger owner, unit and balance', async t => {
  const f = fixture(t); f.state.invoice = true; f.state.orderState = 'submitted';
  await prepareProfileBridge({ operation: 'prepare', userId: owner, orderId });
  await redeemProfileBridge(f.deliveredInput(), booking);
  const session = [...f.sessions.values()][0];
  assert.equal(session.customer_id, owner); assert.equal(session.unit_id, unitId); assert.equal(session.invoice_id, invoiceId);
  assert.equal(session.reference_usd_amount, '199.00'); assert.equal(session.amount, '5273.50');
  assert.equal(f.requests.some(r => r.path.includes('previewInvoice')), false);
});

test('ownership is rechecked on redemption and foreign returns are refused', async t => {
  const f = fixture(t);
  await prepareProfileBridge({ operation: 'prepare', userId: owner, orderId });
  const input = f.deliveredInput();
  await assert.rejects(redeemProfileBridge({ ...input, returnUrl: 'https://evil.example/' }, booking), /RETURN_URL/);
  f.state.owner = other;
  await assert.rejects(redeemProfileBridge(input, booking), /IDENTITY_MISMATCH/);
  assert.equal(f.sessions.size, 0); assert.equal([...f.grants.values()][0].lease_token, null);
});

test('bridge route CORS supports exactly the two customer origins and no anonymous ID checkout', async t => {
  const f = fixture(t);
  const endpoint = 'https://www.payroatanselfstorage.com/api/storeganise/bridge';
  for (const host of [origin, booking, 'https://evil.example', booking + '.evil.example', 'null']) {
    const response = OPTIONS(new NextRequest(endpoint, { method: 'OPTIONS', headers: { origin: host, 'access-control-request-method': 'POST' } }));
    assert.equal(response.status, [origin, booking].includes(host) ? 204 : 403);
    assert.equal(response.headers.get('access-control-allow-origin'), [origin, booking].includes(host) ? host : null);
  }
  const response = await POST(new NextRequest(endpoint, { method: 'POST', headers: { origin: booking, 'content-type': 'application/json' },
    body: JSON.stringify({ operation: 'prepare', userId: owner, orderId }) }));
  assert.equal(response.status, 200); assert.deepEqual(await response.json(), { prepared: true }); assert.equal(f.sessions.size, 0);
  for (const providerStatus of [401, 403, 404, 429]) {
    f.state.providerStatus = providerStatus;
    const failed = await POST(new NextRequest(endpoint, { method: 'POST', headers: { origin: booking, 'content-type': 'application/json' },
      body: JSON.stringify({ operation: 'prepare', userId: owner, orderId }) }));
    assert.equal(failed.status, providerStatus === 429 ? 429 : 503);
    assert.equal((await failed.text()).includes('private provider failure'), false);
    if (providerStatus === 429) assert.equal(failed.headers.get('retry-after'), '600');
  }
});

test('feature is opt-in; sandbox cannot write grants into a real Storeganise account', async t => {
  const f = fixture(t);
  process.env.STOREGANISE_BRIDGE_ENABLED = 'false';
  await assert.rejects(prepareProfileBridge({ operation: 'prepare', userId: owner, orderId }), /BRIDGE_DISABLED/);
  process.env.STOREGANISE_BRIDGE_ENABLED = 'true'; process.env.CYBERSOURCE_ENVIRONMENT = 'sandbox';
  await assert.rejects(prepareProfileBridge({ operation: 'prepare', userId: owner, orderId }), /SANDBOX_INSTANCE_REQUIRED/);
  assert.equal(f.requests.length, 0);
});
