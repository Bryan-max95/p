import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { database, closeDatabase } from '../lib/pay/db';
import { resolveMethodOwner, openPaymentMethodCheckout, exchangeMethodToken, getMethodSession, savePaymentMethod, type MethodSession } from '../lib/storeganise/payment-methods';
import { handleBillingList } from '../lib/storeganise/billing-list';
import { handleBillingCheckout } from '../lib/storeganise/billing-checkout';
import { prepareMethodBridge, redeemMethodBridge } from '../lib/storeganise/payment-method-bridge';
import { bridgeHash, BRIDGE_FIELD, bridgeInput } from '../lib/storeganise/bridge-protocol';
import { CyberSourceGateway, GatewayError } from '../lib/cybersource/gateway';
import { NextRequest } from 'next/server';
import { POST as billingPost } from '../app/api/storeganise/billing/route';

const origin = 'https://roatanselfstorage.storeganise.com', booking = 'https://booking.roatanselfstorage.com';
const userId = '100000000000000000000001', other = '100000000000000000000002', siteId = '300000000000000000000001';
const billTo = { firstName: 'Test', lastName: 'Owner', email: 'test@example.test', address1: 'Test address', locality: 'Roatan', postalCode: '34101', country: 'HN' };

/** Isolated provider and SQL fixture. Never reads .env.local, creates real cards or sends bank requests. */
function fixture(t: TestContext) {
  const env = { DATABASE_URL: 'postgresql://test:test@127.0.0.1:1/unused', CYBERSOURCE_ENVIRONMENT: 'production',
    CYBERSOURCE_MERCHANT_ID: 'unit-test-merchant', CYBERSOURCE_KEY_ID: crypto.randomUUID(),
    CYBERSOURCE_SHARED_SECRET: Buffer.alloc(32, 8).toString('base64'),
    STOREGANISE_API_URL: origin + '/api/v1/admin', STOREGANISE_API_KEY: 'test-only', STOREGANISE_PAY_ENABLED: 'true',
    STOREGANISE_BRIDGE_ENABLED: 'true', PAY_SESSION_TOKEN_SECRET: 'isolated-test-secret-with-more-than-32-characters',
    PAY_PUBLIC_URL: 'https://www.payroatanselfstorage.com', STOREGANISE_WEBHOOK_SECRET: 'test-signature-secret',
    STOREGANISE_PAYMENT_METHOD_SITE_ID: '' };
  const prev = Object.fromEntries(Object.keys(env).map(key => [key, process.env[key]]));
  Object.assign(process.env, env);
  const sessions = new Map<string, MethodSession & { launch_hash: string; access_hash?: string; consumed_at?: Date }>();
  const grants = new Map<string, any>();
  const methods: any[] = [], requests: Array<{ path: string; body?: any }> = [];
  const state = { sites: [{ id: siteId }], disabled: false, customFields: {} as Record<string, unknown>, gatewayFailure: false };
  const run = async (sql: string, v: any[] = []) => {
    sql = sql.trim();
    let rows: any[] = [];
    if (sql.startsWith('INSERT INTO pay_method_sessions')) {
      const row = { id: v[0], launch_hash: v[1], customer_id: v[2], site_id: v[3], api_origin: v[4], environment: v[5], client_name: v[6], return_url: v[7],
        status: 'open', expires_at: new Date(Date.now() + 1800000), capture_context: 'verified-test-context', method_id: null };
      sessions.set(row.id, row);
    } else if (sql.startsWith('UPDATE pay_method_sessions SET consumed_at')) {
      const row = [...sessions.values()].find(s => s.launch_hash === v[0] && !s.consumed_at && s.expires_at.getTime() > Date.now() && s.api_origin === v[2] && s.environment === v[3]);
      if (row) { row.consumed_at = new Date(); row.access_hash = v[1]; rows = [row]; }
    } else if (sql.startsWith('SELECT * FROM pay_method_sessions')) {
      const row = sessions.get(v[0]);
      if (row && (v.length === 1 || row.access_hash === v[1] && row.api_origin === v[2] && row.environment === v[3] && row.expires_at.getTime() > Date.now())) rows = [row];
    } else if (sql.startsWith("UPDATE pay_method_sessions SET status='registering'")) sessions.get(v[0])!.status = 'registering';
    else if (sql.startsWith('UPDATE pay_method_sessions SET status=$2')) sessions.get(v[0])!.status = v[1];
    else if (sql.startsWith("UPDATE pay_method_sessions SET status='saved'")) {
      const row = sessions.get(v[0])!; row.status = 'saved'; row.method_id = v[1]; rows = [row];
    } else if (sql.startsWith('INSERT INTO pay_saved_methods')) {
      const method = { id: v[0], customer_id: v[1], site_id: v[2], api_origin: v[3], environment: v[4], gateway_token: v[5], brand: v[6], last4: v[7], exp_month: v[8], exp_year: v[9], cardholder: v[10] };
      methods.push(method); rows = [method];
    } else if (sql.startsWith('SELECT id,brand,last4')) rows = methods.filter(m => m.customer_id === v[0] && m.api_origin === v[1] && m.environment === v[2] && (!v[3] || m.site_id === v[3]));
    else if (sql.startsWith('SELECT count(*) FROM pay_method_bridge_grants')) rows = [{ count: String(grants.size) }];
    else if (sql.startsWith('INSERT INTO pay_method_bridge_grants')) {
      const row = { id: v[0], token_hash: v[1], customer_id: v[2], site_id: v[3], api_origin: v[4], environment: v[5], expires_at: new Date(Date.now() + 300000), client_hash: null };
      grants.set(row.id, row); rows = [row];
    } else if (sql.startsWith('SELECT * FROM pay_method_bridge_grants WHERE id=')) rows = grants.has(v[0]) ? [grants.get(v[0])] : [];
    else if (sql.startsWith('SELECT * FROM pay_method_bridge_grants')) rows = [...grants.values()].filter(g => !g.client_hash && g.expires_at.getTime() > Date.now());
    else if (sql.startsWith('UPDATE pay_method_bridge_grants SET client_hash')) grants.get(v[0]).client_hash = v[1];
    else if (sql.startsWith('UPDATE pay_method_bridge_grants SET session_id')) grants.get(v[0]).session_id = v[1];
    else if (!sql.startsWith('CREATE TABLE') && !['BEGIN', 'COMMIT', 'ROLLBACK'].includes(sql) && !sql.startsWith('SELECT pg_advisory')) throw new Error('Unexpected SQL: ' + sql);
    return { rows, rowCount: rows.length };
  };
  const pool = database();
  t.mock.method(pool, 'query', run);
  t.mock.method(pool, 'connect', async () => ({ query: run, release() {} }));
  t.mock.method(globalThis, 'fetch', async (url: string, init?: RequestInit) => {
    const target = new URL(String(url));
    const path = target.pathname.replace('/api/v1/admin', '');
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    requests.push({ path, body });
    if (target.origin === 'https://api.cybersource.com') {
      assert.equal(path, '/pts/v2/payments');
      if (state.gatewayFailure) throw new Error('uncertain network');
      return Response.json({ id: '123456789012345', status: 'AUTHORIZED', tokenInformation: { paymentInstrument: { id: 'stored-token-test' } }, orderInformation: { amountDetails: { authorizedAmount: '0', currency: 'HNL' } } });
    }
    assert.equal(target.origin, origin);
    if (path === '/sites') return Response.json(state.sites);
    if (path === '/settings') return Response.json({ userCustomFields: [{ code: BRIDGE_FIELD, type: 'string', ownerAcl: 'read' }] });
    if (path.startsWith('/users/') && init?.method === 'PUT') { Object.assign(state.customFields, body.customFields); return Response.json({}); }
    if (path.startsWith('/users/')) return Response.json({ id: path.split('/')[2], firstName: 'Test', lastName: 'Owner', email: 'test@example.test', isDisabled: state.disabled, customFields: state.customFields });
    throw new Error('Unexpected request: ' + path);
  });
  t.mock.method(CyberSourceGateway.prototype, 'verifyTransientToken', async () => ({ tokenJwt: 'test-token', tokenId: 'test-id', cardType: '001', brand: 'Visa', last4: '4242', expirationMonth: '12', expirationYear: '2029', expiresAt: new Date(Date.now() + 600000).toISOString() }));
  t.after(async () => { t.mock.restoreAll(); await closeDatabase(); for (const [key, value] of Object.entries(prev)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
  return { state, sessions, grants, methods, requests };
}

test('account checkout works without order or site hint, and launch links exchange exactly once', async t => {
  const f = fixture(t);
  const result = await handleBillingCheckout({ type: 'billing.checkout', data: { userId, returnUrl: booking + '/account/billing' } });
  const url = new URL(result.url);
  assert.equal(url.searchParams.get('flow'), 'payment_method');
  assert.match(result.html, /pay-checkout-url/);
  const exchange = await exchangeMethodToken(url.searchParams.get('session')!);
  assert.equal(exchange.session.customer_id, userId); assert.equal(exchange.session.site_id, siteId);
  assert.equal(exchange.session.return_url, booking + '/account/billing');
  await assert.rejects(exchangeMethodToken(url.searchParams.get('session')!), /INVALID_OR_EXPIRED/);
  await assert.rejects(getMethodSession(exchange.session.id, 'wrong'), /INVALID_OR_EXPIRED/);
  assert.equal(f.requests.some(r => /jobs|invoices|payments/.test(r.path)), false);
});

test('missing site is resolved only for one site; foreign sites, ambiguous sites, disabled users and unsafe returns fail', async t => {
  const f = fixture(t);
  await assert.rejects(resolveMethodOwner({ userId, siteId: other }), /SITE_MISMATCH/);
  f.state.sites.push({ id: other });
  await assert.rejects(resolveMethodOwner({ userId }), /PAYMENT_SITE_REQUIRED/);
  assert.equal((await resolveMethodOwner({ userId, siteId })).siteId, siteId);
  await assert.rejects(resolveMethodOwner({ userId, siteId, returnUrl: 'https://evil.example/account/billing' }), /RETURN_URL/);
  await assert.rejects(resolveMethodOwner({ userId, siteId, returnUrl: booking + '/account/units' }), /RETURN_URL/);
  f.state.disabled = true;
  await assert.rejects(resolveMethodOwner({ userId, siteId }), /CUSTOMER_DISABLED/);
});

test('verified card is saved with zero amount, no capture, and listed only for its owner and site', async t => {
  const f = fixture(t);
  assert.deepEqual(await handleBillingList({ data: { userId, siteId } }), []);
  const opened = await openPaymentMethodCheckout({ userId, siteId });
  const session = f.sessions.get(opened.sessionId)!;
  const saved = await savePaymentMethod(session, { token: 'x'.repeat(120), billTo });
  assert.equal(saved.status, 'saved');
  const bank = f.requests.find(r => r.path === '/pts/v2/payments')!.body;
  assert.equal(bank.orderInformation.amountDetails.totalAmount, '0');
  assert.equal(bank.processingInformation.capture, false);
  assert.deepEqual(bank.processingInformation.actionTokenTypes, ['paymentInstrument']);
  const listed = await handleBillingList({ data: { userId, siteId } });
  assert.equal(listed.length, 1); assert.equal(listed[0].last4, '4242'); assert.equal(listed[0].expYear, 2029);
  assert.equal(JSON.stringify(listed).includes('stored-token-test'), false);
  assert.deepEqual(await handleBillingList({ data: { userId: other, siteId } }), []);
  assert.deepEqual(await handleBillingList({ data: { userId, siteId: other } }), []);
  await savePaymentMethod(session, { token: 'x'.repeat(120), billTo });
  assert.equal(f.requests.filter(r => r.path === '/pts/v2/payments').length, 1);
  assert.equal(f.requests.some(r => /invoices|jobs|unit-rentals/.test(r.path)), false);
});

test('uncertain registration blocks another provider request', async t => {
  const f = fixture(t);
  const opened = await openPaymentMethodCheckout({ userId, siteId });
  const session = f.sessions.get(opened.sessionId)!;
  f.state.gatewayFailure = true;
  await assert.rejects(savePaymentMethod(session, { token: 'x'.repeat(120), billTo }), /REGISTRATION_PENDING/);
  assert.equal(session.status, 'uncertain');
  await assert.rejects(savePaymentMethod(session, { token: 'x'.repeat(120), billTo }), /REGISTRATION_PENDING/);
  assert.equal(f.requests.filter(r => r.path === '/pts/v2/payments').length, 1);
  assert.equal(f.methods.length, 0);
});

test('method bridge privately delivers scoped grant, preserves reservation grant and rejects forgery, cross-site and replay', async t => {
  const f = fixture(t);
  f.state.customFields[BRIDGE_FIELD] = JSON.stringify({ version: 1, grants: [{ id: 'reservation', orderId: other, expiresAt: new Date(Date.now() + 300000).toISOString() }] });
  assert.deepEqual(await prepareMethodBridge({ userId }), { prepared: true });
  const delivered = JSON.parse(String(f.state.customFields[BRIDGE_FIELD])).grants;
  assert.equal(delivered.length, 2);
  const grant = delivered.find((g: any) => g.purpose === 'payment_method');
  const input = { grantId: grant.id, token: grant.token, siteId: grant.siteId, clientNonce: crypto.randomBytes(32).toString('base64url'), returnUrl: booking + '/account/billing' };
  assert.equal(f.grants.get(grant.id).token_hash, bridgeHash(grant.token));
  await assert.rejects(redeemMethodBridge({ ...input, token: 'a'.repeat(43) }, booking), /ACCESS_INVALID/);
  await assert.rejects(redeemMethodBridge({ ...input, siteId: other }, booking), /ACCESS_INVALID/);
  const result = await redeemMethodBridge(input, booking);
  assert.equal(new URL(result.url).searchParams.get('flow'), 'payment_method');
  await assert.rejects(redeemMethodBridge(input, booking), /ACCESS_USED/);
  assert.equal(bridgeInput.safeParse({ operation: 'prepare_payment_method', userId }).success, true);
  assert.equal(bridgeInput.safeParse({ operation: 'prepare_payment_method', userId, orderId: other }).success, false);
});

test('Billing rejects unsigned checkout and accepts signed empty list', async t => {
  fixture(t);
  const raw = JSON.stringify({ type: 'billing.list', data: { userId, siteId } });
  const unsigned = await billingPost(new NextRequest('https://www.payroatanselfstorage.com/api/storeganise/billing', { method: 'POST', body: raw }));
  assert.equal(unsigned.status, 401);
  const signature = crypto.createHmac('sha256', process.env.STOREGANISE_WEBHOOK_SECRET!).update(raw).digest('base64');
  const signed = await billingPost(new NextRequest('https://www.payroatanselfstorage.com/api/storeganise/billing', { method: 'POST', body: raw, headers: { 'sg-signature': signature } }));
  assert.equal(signed.status, 200); assert.deepEqual(await signed.json(), []);
});
