import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { database, closeDatabase } from '../lib/pay/db';
import type { SessionRow } from '../lib/pay/types';
import { finishAttempt, publicSession } from '../lib/pay/service';
import { bridgeInput, bridgeHash, BRIDGE_FIELD } from '../lib/storeganise/bridge-protocol';
import { assertInvoiceBridgeProof, prepareInvoiceBridge, redeemInvoiceBridge, type InvoiceGrant } from '../lib/storeganise/invoice-bridge';
import { accountInvoiceReturn, getAccountInvoice, openAccountInvoiceCheckout, type AccountInvoice } from '../lib/storeganise/invoice-checkout';
import { verifyStoreganiseCheckout } from '../lib/storeganise/checkout';
import { syncStoreganiseSession } from '../lib/storeganise/sync';

const owner = '100000000000000000000001', other = '100000000000000000000002';
const siteId = '300000000000000000000001', invoiceId = '600000000000000000000001';
const rentalId = '700000000000000000000001', jobId = '200000000000000000000001', unitId = '500000000000000000000001';
const origin = 'https://roatanselfstorage.storeganise.com', booking = 'https://booking.roatanselfstorage.com';
const invoiceRef = 'usdservice1', returnUrl = `${booking}/account/invoices/USDSERVICE1?pay&_n=1`;
const nonce = () => crypto.randomBytes(32).toString('base64url');

// All external I/O is mocked. Tests cannot charge a card, update a real invoice,
// read live credentials, or connect to Postgres.
function fixture(t: TestContext) {
  const env = { DATABASE_URL: 'postgresql://test:test@127.0.0.1:1/unused', BCH_API_KEY: 'unit-test-only',
    CYBERSOURCE_ENVIRONMENT: 'production', CYBERSOURCE_MERCHANT_ID: 'unit-test', CYBERSOURCE_KEY_ID: crypto.randomUUID(),
    CYBERSOURCE_SHARED_SECRET: Buffer.alloc(32, 8).toString('base64'), STOREGANISE_PAY_ENABLED: 'true',
    STOREGANISE_BRIDGE_ENABLED: 'true', STOREGANISE_API_URL: origin + '/api/v1/admin', STOREGANISE_API_KEY: 'unit-test-only',
    STOREGANISE_LIVE_SANDBOX_ENABLED: 'false', STOREGANISE_SANDBOX_ACTIVATION_ENABLED: 'false', STOREGANISE_CARD_PAYMENT_METHOD: 'card',
    PAY_SESSION_TOKEN_SECRET: 'unit-test-secret-more-than-thirty-two-characters', PAY_PUBLIC_URL: 'https://www.payroatanselfstorage.com' };
  const previous = Object.fromEntries(Object.keys(env).map(key => [key, process.env[key]])); Object.assign(process.env, env);
  const invoice: AccountInvoice = { id: invoiceId, sid: invoiceRef, owner: { id: owner }, siteId, state: 'sent',
    balance: 49, total: 49, currencyCode: 'USD', payments: [], entries: [{ desc: 'Servicio de transporte' }] };
  const sessions = new Map<string, SessionRow>(), grants = new Map<string, InvoiceGrant>();
  const requests: Array<{ path: string; method: string; body?: Record<string, unknown> }> = [];
  const state = { customFields: {} as Record<string, unknown>, disabled: false, lease: '', queued: false,
    deliveryStatus: 'pending', paymentStarted: false, timeout: '' as '' | 'before' | 'after', launchCount: 0, initialInvoice: false };
  const runQuery = async (sql: string, values: unknown[] = []) => {
    const text = sql.trim(); let rows: unknown[] = [];
    const session = sessions.get(String(values[0]));
    if (text.startsWith('SELECT count(*) FROM pay_invoice_bridge_grants')) rows = [{ count: String(grants.size) }];
    else if (text.startsWith('SELECT * FROM pay_invoice_bridge_grants WHERE id=')) rows = grants.has(String(values[0])) ? [grants.get(String(values[0]))] : [];
    else if (text.startsWith('SELECT * FROM pay_invoice_bridge_grants')) rows = [...grants.values()].filter(g => !g.client_hash && g.expires_at.getTime() > Date.now());
    else if (text.startsWith('INSERT INTO pay_invoice_bridge_grants')) {
      const g: InvoiceGrant = { id: String(values[0]), token_hash: String(values[1]), customer_id: String(values[2]),
        invoice_id: String(values[3]), invoice_ref: String(values[4]), site_id: String(values[5]), api_origin: String(values[6]),
        environment: String(values[7]), expires_at: new Date(Date.now() + 300000), client_hash: null, session_id: null, lease_token: null, lease_until: null };
      grants.set(g.id, g); rows = [g];
    } else if (text.startsWith('UPDATE pay_invoice_bridge_grants SET expires_at=')) {
      for (const g of grants.values()) if (g.invoice_id === values[2] && !g.client_hash) g.expires_at = new Date(0);
    } else if (text.startsWith('UPDATE pay_invoice_bridge_grants SET client_hash=')) {
      Object.assign(grants.get(String(values[0]))!, { client_hash: values[1], lease_token: values[2], lease_until: new Date(Date.now() + 90000) });
    } else if (text.startsWith('UPDATE pay_invoice_bridge_grants SET session_id=')) {
      const g = grants.get(String(values[0]))!;
      if (g.lease_token === values[2]) { Object.assign(g, { session_id: values[1], lease_token: null, lease_until: null }); rows = [g]; }
    } else if (text.startsWith('UPDATE pay_invoice_bridge_grants SET lease_token=')) {
      const g = grants.get(String(values[0]))!;
      if (g.lease_token === values[1]) Object.assign(g, { lease_token: null, lease_until: null });
    } else if (text.startsWith('SELECT rate FROM pay_exchange_rates')) rows = [{ rate: { source: 'BCH', indicatorId: 620,
      hnlPerUsd: '26.500000', rateDate: new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Tegucigalpa' }).format(new Date()), fetchedAt: new Date().toISOString() } }];
    else if (text.startsWith('SELECT * FROM pay_sessions WHERE event_id=')) rows = [...sessions.values()].filter(s => s.event_id === values[0]);
    else if (text.startsWith('SELECT * FROM pay_sessions WHERE environment=')) rows = [...sessions.values()].filter(s => s.environment === values[0] && s.invoice_id === values[1]);
    else if (text.startsWith('SELECT * FROM pay_sessions WHERE id=')) rows = session ? [session] : [];
    else if (text.startsWith('INSERT INTO pay_sessions')) {
      const s = { id: values[0], event_id: values[1], launch_hash: values[2], customer_id: values[3], order_id: values[4], invoice_id: values[5],
        unit_id: values[6], client_name: values[7], unit_name: values[8], concept: values[9], currency: values[10], amount: values[11],
        bill_to: JSON.parse(String(values[12])), return_url: values[13], is_demo: values[14], portal_status: values[15],
        reference_usd_amount: values[16], usd_hnl_rate: values[17], fx_source: values[18], fx_rate_date: values[19],
        fx_fetched_at: new Date(String(values[20])), environment: values[21], checkout_source: values[22],
        storeganise_context: JSON.parse(String(values[23])), storeganise_status: values[24], fx_indicator_id: values[25],
        status: 'open', created_at: new Date(), expires_at: new Date(Date.now() + 1800000) } as SessionRow;
      sessions.set(s.id, s); rows = [s];
    } else if (text.startsWith('UPDATE pay_sessions SET reference_usd_amount=')) {
      Object.assign(session!, { reference_usd_amount: values[1], amount: values[2], currency: 'HNL', usd_hnl_rate: values[3],
        fx_rate_date: values[4], fx_fetched_at: new Date(String(values[5])), fx_indicator_id: values[6], capture_context: null,
        expires_at: new Date(Date.now() + 1800000) }); rows = [session];
    } else if (text.startsWith('UPDATE pay_sessions SET return_url=')) session!.return_url = String(values[1]);
    else if (text.startsWith('INSERT INTO pay_launch_links')) state.launchCount++;
    else if (text.startsWith('DELETE FROM pay_launch_links')) { /* expiry cleanup */ }
    else if (text.startsWith('SELECT session_id,status,payment_mode FROM pay_attempts')) rows = [{ session_id: [...sessions.keys()][0], status: 'processing', payment_mode: 'payment' }];
    else if (text.startsWith('SELECT id FROM pay_attempts')) rows = [{ id: 'attempt' }];
    else if (text.startsWith('UPDATE pay_attempts SET status=')) rows = [{ session_id: [...sessions.keys()][0] }];
    else if (text.startsWith('UPDATE pay_sessions SET status=')) Object.assign(session!, { status: values[1], gateway_transaction_id: values[2], gateway_status: values[6], paid_at: values[1] === 'succeeded' ? new Date() : undefined });
    else if (text.startsWith('INSERT INTO storeganise_deliveries')) state.queued = true;
    else if (text.startsWith("UPDATE pay_sessions SET storeganise_status='pending'")) session!.storeganise_status = 'pending';
    else if (text.startsWith('UPDATE storeganise_deliveries d SET lease_token=')) {
      if (state.queued && session?.status === 'succeeded' && !state.lease && !['active','invoice_paid','sandbox_only'].includes(state.deliveryStatus)) {
        state.lease = String(values[1]); rows = [{ session_id: session.id, transaction_id: session.gateway_transaction_id,
          attempt_count: 1, payment_write_started: state.paymentStarted, lease_token: state.lease }];
      }
    } else if (text.startsWith('UPDATE storeganise_deliveries SET status=')) {
      if (state.lease === values[1]) { state.lease = ''; state.deliveryStatus = String(values[2]); rows = [{ session_id: values[0] }]; }
    } else if (text.startsWith('UPDATE pay_sessions SET storeganise_status=$2')) Object.assign(session!, {
      storeganise_status: values[1], storeganise_error: values[2], storeganise_payment_id: values[3] });
    else if (text.startsWith('UPDATE storeganise_deliveries SET payment_write_started=true')) {
      if (!state.paymentStarted && values[1] === state.lease) { state.paymentStarted = true; rows = [{ session_id: values[0] }]; }
    } else if (!['BEGIN','COMMIT','ROLLBACK'].includes(text) && !text.includes('pg_advisory_xact_lock') && !text.includes('CREATE TABLE IF NOT EXISTS')) throw new Error(`Unhandled query: ${text}`);
    return { rows: structuredClone(rows), rowCount: rows.length };
  };
  const pool = database(); t.mock.method(pool, 'query', runQuery);
  t.mock.method(pool, 'connect', async () => ({ query: runQuery, release() {} }));
  t.mock.method(globalThis, 'fetch', async (url: string | URL | Request, init?: RequestInit) => {
    const target = new URL(String(url)); assert.equal(target.origin, origin, 'Never calls a bank or any live host');
    const path = target.pathname.replace('/api/v1/admin', ''), method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) : undefined; requests.push({ path, method, body });
    if (path === `/invoices/${invoiceId}/payments` && method === 'POST') {
      if (state.timeout === 'before') throw new Error('Lost response, provider outcome unknown');
      invoice.payments.push({ ...body, id: 'sg-payment' }); invoice.balance = 0; invoice.state = 'paid';
      if (state.timeout === 'after') throw new Error('Lost response after applying payment');
      return Response.json({});
    }
    if (path === `/invoices/${invoiceId}` || path === `/invoices/${invoiceRef}`) return Response.json(invoice);
    if (path === `/unit-rentals/${rentalId}`) return Response.json({ id: rentalId, ownerId: owner, siteId, unitId, state: 'active', moveInJobId: jobId });
    if (path === `/jobs/${jobId}`) return Response.json({ id: jobId, ownerId: owner, type: 'unit_moveIn', state: 'ready', steps: [],
      result: { invoiceId: state.initialInvoice ? invoiceId : other, unitRentalId: rentalId, unitId, siteId, orderState: 'submitted' } });
    if (path === `/units/${unitId}`) return Response.json({ id: unitId, siteId, name: 'A1', state: 'reserved', ownerId: owner, rentalId });
    if (path === `/users/${owner}` && method === 'GET') return Response.json({ id: owner, firstName: 'Test', lastName: 'Customer', email: 'unit@example.test', isDisabled: state.disabled, customFields: state.customFields });
    if (path === `/users/${owner}` && method === 'PUT') { Object.assign(state.customFields, body.customFields); return Response.json({}); }
    if (path === '/settings') return Response.json({ currencyCode: 'USD', manualPaymentMethods: [{ code: 'card' }],
      userCustomFields: [{ code: BRIDGE_FIELD, type: 'string', ownerAcl: 'read', maxLength: 4096 }] });
    throw new Error(`Unexpected provider call: ${method} ${path}`);
  });
  t.after(async () => { await closeDatabase(); for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  } });
  const open = () => openAccountInvoiceCheckout({ userId: owner, invoiceId, siteId, returnUrl });
  const prepare = () => prepareInvoiceBridge({ operation: 'prepare_invoice', userId: owner, invoiceRef });
  const redeemInput = () => { const g = JSON.parse(String(state.customFields[BRIDGE_FIELD])).grants.find((g: { purpose?: string }) => g.purpose === 'invoice');
    return { operation: 'redeem_invoice' as const, grantId: g.id, token: g.token, clientNonce: nonce(), siteId, invoiceRef, returnUrl }; };
  const pay = async (status: 'succeeded' | 'declined' | 'unknown' = 'succeeded') => {
    await finishAttempt('attempt', { status, ...(status === 'succeeded' ? { transactionId: 'verified-bank-transaction' } : {}), gatewayStatus: status === 'succeeded' ? 'AUTHORIZED' : 'DECLINED' });
  };
  return { state, invoice, sessions, grants, requests, open, prepare, redeemInput, pay };
}

test('invoice protocol accepts SID, rejects browser prices/order/context and normalizes case', () => {
  assert.equal(bridgeInput.parse({ operation: 'prepare_invoice', userId: owner, invoiceRef: 'USDSERVICE1' }).operation, 'prepare_invoice');
  for (const extra of [{ amount: '1.00' }, { orderId: invoiceId }, { invoiceId }, { invoiceRef: '../users' }]) {
    assert.equal(bridgeInput.safeParse({ operation: 'prepare_invoice', userId: owner, invoiceRef, ...extra }).success, false);
  }
});

test('owner profile receives a scoped invoice grant while prepare reveals no access and preserves the other flows', async t => {
  const f = fixture(t); const method = { purpose: 'payment_method', id: 'method', expiresAt: new Date(Date.now() + 300000).toISOString() };
  f.state.customFields = { unrelated: 'keep', [BRIDGE_FIELD]: JSON.stringify({ version: 1, grants: [method] }) };
  assert.deepEqual(await f.prepare(), { prepared: true }); await f.prepare();
  assert.equal(f.grants.size, 1); assert.equal(f.state.customFields.unrelated, 'keep');
  const profile = JSON.parse(String(f.state.customFields[BRIDGE_FIELD])); assert.deepEqual(profile.grants[0], method);
  const input = f.redeemInput(), g = f.grants.get(input.grantId)!;
  assertInvoiceBridgeProof(g, input, { apiOrigin: origin, environment: 'production' });
  for (const changed of [{ token: nonce() }, { siteId: other }, { invoiceRef: 'other' }]) {
    assert.throws(() => assertInvoiceBridgeProof(g, { ...input, ...changed }, { apiOrigin: origin, environment: 'production' }), /ACCESS_INVALID/);
  }
  assert.throws(() => assertInvoiceBridgeProof(g, input, { apiOrigin: origin, environment: 'sandbox' }), /ACCESS_INVALID/);
  assert.throws(() => assertInvoiceBridgeProof({ ...g, expires_at: new Date(0) }, input, { apiOrigin: origin, environment: 'production' }), /ACCESS_EXPIRED/);
  assert.throws(() => assertInvoiceBridgeProof({ ...g, client_hash: bridgeHash(nonce()) }, input, { apiOrigin: origin, environment: 'production' }), /ACCESS_USED/);
  const first = await redeemInvoiceBridge(input, booking), second = await redeemInvoiceBridge(input, booking);
  assert.notEqual(first.url, second.url); assert.equal(f.sessions.size, 1); assert.equal(f.state.launchCount, 2);
  await assert.rejects(redeemInvoiceBridge({ ...input, clientNonce: nonce() }, booking), /ACCESS_USED/);
  assert.equal(f.requests.filter(r => r.method !== 'GET' && !r.path.startsWith('/users/')).length, 0);
});

test('service without a rental shows its own description, exact balance and stored BCH conversion', async t => {
  const f = fixture(t); assert.equal((await getAccountInvoice('USDSERVICE1')).id, invoiceId);
  const a = await f.open(); await f.open(); assert.equal(f.sessions.size, 1);
  const s = f.sessions.get(a.sessionId)!, view = publicSession(s);
  assert.equal(view.concept, 'Servicio de transporte'); assert.equal(view.unitName, 'USDSERVICE1');
  assert.equal(view.priceReference?.amount, '49.00'); assert.equal(view.amount, '1298.50'); assert.equal(view.currency, 'HNL');
  assert.equal(view.storeganise?.kind, 'account_invoice'); assert.equal(s.order_id, null);
  assert.equal(view.storeganise?.returnUrl, `${booking}/account/invoices/USDSERVICE1`);
  await verifyStoreganiseCheckout(s);
  assert.equal(f.requests.some(r => /unit-rentals|jobs|units/.test(r.path)), false);
});

test('first move-in invoice retains the reservation activation binding; later services use invoice-only reconciliation', async t => {
  const f = fixture(t); f.invoice.unitRentalId = rentalId; f.state.initialInvoice = true;
  const first = await f.open(), reservation = f.sessions.get(first.sessionId)!;
  assert.equal(reservation.storeganise_context?.kind, 'invoice'); assert.equal(reservation.storeganise_context?.jobId, jobId);
  assert.equal(reservation.unit_id, unitId); await verifyStoreganiseCheckout(reservation);
  f.sessions.clear(); f.state.initialInvoice = false;
  const second = await f.open(), service = f.sessions.get(second.sessionId)!;
  assert.equal(service.storeganise_context?.kind, 'account_invoice'); assert.equal(service.storeganise_context?.jobId, undefined);
  await f.pay(); await syncStoreganiseSession(service.id);
  assert.equal(service.storeganise_status, 'invoice_paid');
  assert.equal(f.requests.some(r => r.method !== 'GET' && /jobs|units|unit-rentals/.test(r.path)), false);
});

test('foreign return and a busy grant cannot open checkout, and the same tab recovers after a failed lookup', async t => {
  const f = fixture(t); await f.prepare(); const input = f.redeemInput(), grant = f.grants.get(input.grantId)!;
  await assert.rejects(redeemInvoiceBridge({ ...input, returnUrl: `${booking}/account/invoices/OTHER` }, booking), /INVALID_STOREGANISE_RETURN_URL/);
  grant.lease_until = new Date(Date.now() + 90000);
  await assert.rejects(redeemInvoiceBridge(input, booking), /BRIDGE_BUSY/); grant.lease_until = null;
  f.state.disabled = true; await assert.rejects(redeemInvoiceBridge(input, booking), /CUSTOMER_DISABLED/);
  assert.equal(grant.lease_until, null); assert.equal(f.sessions.size, 0);
  f.state.disabled = false; assert.match((await redeemInvoiceBridge(input, booking)).url, /\?session=/);
});

test('invoice changes, foreign ownership, disabled customer and invalid return cannot authorize a charge', async t => {
  const f = fixture(t); const opened = await f.open(), s = f.sessions.get(opened.sessionId)!;
  f.invoice.balance = 30; await assert.rejects(verifyStoreganiseCheckout(s), /INVOICE_AMOUNT_CHANGED/);
  await f.open(); assert.equal(s.amount, '795.00'); await verifyStoreganiseCheckout(s);
  f.invoice.owner.id = other; await assert.rejects(f.prepare(), /IDENTITY_MISMATCH/); await assert.rejects(verifyStoreganiseCheckout(s), /IDENTITY_MISMATCH/);
  f.invoice.owner.id = owner; f.invoice.siteId = other; await assert.rejects(verifyStoreganiseCheckout(s), /IDENTITY_MISMATCH/);
  f.invoice.siteId = siteId; f.state.disabled = true; await assert.rejects(verifyStoreganiseCheckout(s), /CUSTOMER_DISABLED/);
  for (const bad of ['https://evil.example/account/invoices/USDSERVICE1', `${booking}/account/invoices/OTHER`, `${booking}/api/v1/billing/custom`]) {
    assert.throws(() => accountInvoiceReturn(bad, f.invoice), /INVALID_STOREGANISE_RETURN_URL/);
  }
});

test('paid, pending, delayed and draft invoices are not offered for a second charge', async t => {
  const f = fixture(t);
  for (const state of ['paid', 'pending', 'delayed', 'draft']) {
    f.invoice.state = state; await assert.rejects(f.open(), /INVOICE_NOT_PAYABLE/);
  }
  f.invoice.state = 'sent'; f.invoice.balance = 0; await assert.rejects(f.prepare(), /INVOICE_NOT_PAYABLE/);
  assert.equal(f.sessions.size, 0);
});

test('approved payment applies exactly once to the chosen service invoice and verifies paid without any unit activation', async t => {
  const f = fixture(t); const result = await f.open(), s = f.sessions.get(result.sessionId)!;
  await f.pay(); assert.equal(s.storeganise_status, 'pending'); await syncStoreganiseSession(s.id); await syncStoreganiseSession(s.id);
  assert.equal(s.storeganise_status, 'invoice_paid'); assert.equal(f.invoice.balance, 0);
  assert.equal(s.storeganise_payment_id, 'sg-payment');
  const writes = f.requests.filter(r => r.method !== 'GET'); assert.equal(writes.length, 1);
  assert.equal(writes[0].path, `/invoices/${invoiceId}/payments`); assert.equal(writes[0].body?.amount, 49);
  assert.match(String(writes[0].body?.notes), /HNL 1298.50/);
  assert.equal(publicSession(s).storeganise?.status, 'invoice_paid');
});

test('lost payment response is recovered by readback and never repeats the financial write', async t => {
  const f = fixture(t); const { sessionId } = await f.open(); await f.pay(); f.state.timeout = 'after';
  await syncStoreganiseSession(sessionId); assert.equal(f.sessions.get(sessionId)!.storeganise_status, 'review');
  await syncStoreganiseSession(sessionId); assert.equal(f.sessions.get(sessionId)!.storeganise_status, 'invoice_paid');
  assert.equal(f.requests.filter(r => r.method === 'POST').length, 1);
});

test('unconfirmed write stays in review and cannot mark the invoice paid or send a duplicate', async t => {
  const f = fixture(t); const { sessionId } = await f.open(); await f.pay(); f.state.timeout = 'before';
  await syncStoreganiseSession(sessionId); await syncStoreganiseSession(sessionId);
  assert.equal(f.sessions.get(sessionId)!.storeganise_status, 'review'); assert.equal(f.invoice.balance, 49);
  assert.equal(f.requests.filter(r => r.method === 'POST').length, 1);
});

test('balance changed after approval requires review instead of paying a different balance', async t => {
  const f = fixture(t); const { sessionId } = await f.open(); await f.pay(); f.invoice.balance = 20;
  await syncStoreganiseSession(sessionId); assert.equal(f.sessions.get(sessionId)!.storeganise_status, 'review');
  assert.equal(f.requests.filter(r => r.method === 'POST').length, 0);
});

for (const outcome of ['declined','unknown'] as const) test(`${outcome} bank result cannot pay a Storeganise invoice`, async t => {
  const f = fixture(t); const { sessionId } = await f.open(); await f.pay(outcome); await syncStoreganiseSession(sessionId);
  assert.equal(f.state.queued, false); assert.equal(f.requests.filter(r => r.method === 'POST').length, 0);
  assert.equal(publicSession(f.sessions.get(sessionId)!).receipt, undefined);
});
