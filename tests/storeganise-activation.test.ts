import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { database, closeDatabase } from '../lib/pay/db';
import { finishAttempt, publicSession } from '../lib/pay/service';
import type { SessionRow } from '../lib/pay/types';
import { syncStoreganiseSession } from '../lib/storeganise/sync';
import { bindPaidReservation, completePaidMoveIn } from '../lib/storeganise/paid-booking';
import { storeganisePaymentWritesAllowed } from '../lib/storeganise/payment-policy';
import { repeatSandboxPayment } from '../lib/pay/repeat-sandbox';

const owner = '100000000000000000000001', jobId = '200000000000000000000001';
const siteId = '300000000000000000000001', unitId = '400000000000000000000001';
const typeId = '500000000000000000000001', rentalId = '600000000000000000000001', invoiceId = '700000000000000000000001';
const origin = 'https://activation-test.storeganise.com';

/** In-memory DB and provider only. No credentials or actual financial requests. */
function fixture(t: TestContext) {
  const env = { DATABASE_URL: 'postgresql://test:test@127.0.0.1:1/unused', STOREGANISE_PAY_ENABLED: 'true',
    STOREGANISE_API_URL: origin + '/api/v1/admin', STOREGANISE_API_KEY: 'unit-test', CYBERSOURCE_ENVIRONMENT: 'sandbox',
    STOREGANISE_LIVE_SANDBOX_ENABLED: 'true', STOREGANISE_SANDBOX_ACTIVATION_ENABLED: 'true',
    STOREGANISE_COMPLETE_PAID_INVOICE_STEP: 'true', STOREGANISE_CARD_PAYMENT_METHOD: 'card' };
  const previous = Object.fromEntries(Object.keys(env).map(key => [key, process.env[key]]));
  Object.assign(process.env, env);
  const session: SessionRow = { id: '11111111-1111-4111-8111-111111111111', event_id: 'test', launch_hash: 'unused',
    customer_id: owner, order_id: jobId, unit_id: unitId, client_name: 'Test', unit_name: 'A1', concept: 'Test',
    currency: 'HNL', amount: '5273.50', reference_usd_amount: '199.00', usd_hnl_rate: '26.5', fx_rate_date: '2026-10-16',
    bill_to: { firstName: 'Test', lastName: 'Only', email: 'unit@example.test', address1: 'Test', locality: 'Test', country: 'HN', postalCode: '34101' },
    environment: 'sandbox', is_demo: false, checkout_source: 'storeganise', status: 'processing', portal_status: 'disabled',
    storeganise_status: 'waiting_payment', created_at: new Date(), expires_at: new Date(Date.now() + 1800000),
    storeganise_context: { kind: 'reservation', apiOrigin: origin, customerId: owner, siteId, jobId, unitId,
      unitTypeId: typeId, selectedUnitId: unitId, reservationAuthentication: 'profile-bridge', sandboxActivation: 'live-storeganise-v1' } };
  const steps = [
    { id: 'submit', type: 'await_submitOrder', state: 'ready', result: {} },
    { id: 'confirm', type: 'order_confirm', state: 'pending', result: {} },
    { id: 'invoice', type: 'invoice_createInitial', state: 'pending', result: { invoiceId } },
    { id: 'occupy', type: 'confirm_occupy', state: 'pending', result: {} },
  ];
  const state = { queued: false, lease: '', paymentStarted: false, deliveryStatus: 'pending', attemptStatus: 'processing',
    jobOwner: owner, unitOwner: owner, unitState: 'reserved', invoiceExists: false, balance: 199, total: 199,
    orderState: 'notSubmitted', paymentTimeout: false, stepTimeout: '', createInvoiceDelay: false,
    wrongAssignment: false, payments: [] as Array<{ id: string; type: string; method: string; amount: number; notes: string }> };
  const operations = new Set<string>();
  const writes: Array<{ path: string; body: Record<string, unknown> }> = [];
  const runQuery = async (sql: string, values: unknown[] = []) => {
    const text = sql.trim(); let rows: unknown[] = [];
    if (text.startsWith('SELECT session_id,status,payment_mode FROM pay_attempts')) rows = [{ session_id: session.id, status: state.attemptStatus, payment_mode: 'payment' }];
    else if (text.startsWith('SELECT * FROM pay_sessions WHERE id=')) rows = [session];
    else if (text.startsWith('SELECT id FROM pay_attempts')) rows = [{ id: 'attempt' }];
    else if (text.startsWith('UPDATE pay_attempts SET status=')) { state.attemptStatus = String(values[1]); rows = [{ session_id: session.id }]; }
    else if (text.startsWith('UPDATE pay_sessions SET status=')) Object.assign(session, {
      status: values[1], gateway_transaction_id: values[2], gateway_status: values[6], paid_at: values[1] === 'succeeded' ? new Date() : undefined });
    else if (text.startsWith('INSERT INTO storeganise_deliveries')) state.queued = true;
    else if (text.startsWith("UPDATE pay_sessions SET storeganise_status='pending'")) session.storeganise_status = 'pending';
    else if (text.startsWith('UPDATE storeganise_deliveries d SET lease_token=')) {
      if (state.queued && session.status === 'succeeded' && !state.lease && !['active','sandbox_only'].includes(state.deliveryStatus)) {
        state.lease = String(values[1]); rows = [{ session_id: session.id, transaction_id: session.gateway_transaction_id,
          attempt_count: 1, payment_write_started: state.paymentStarted, lease_token: state.lease }];
      }
    } else if (text.startsWith('UPDATE storeganise_deliveries SET status=')) {
      if (state.lease === values[1]) { state.lease = ''; state.deliveryStatus = String(values[2]); rows = [{ session_id: session.id }]; }
    } else if (text.startsWith('UPDATE pay_sessions SET storeganise_status=$2')) {
      session.storeganise_status = String(values[1]); session.storeganise_error = values[2] as string | null;
      session.storeganise_payment_id = values[3] as string | null;
    } else if (text.startsWith('UPDATE storeganise_deliveries SET payment_write_started=true')) {
      if (!state.paymentStarted && values[1] === state.lease) { state.paymentStarted = true; rows = [{ session_id: session.id }]; }
    } else if (text.startsWith('INSERT INTO storeganise_step_operations')) {
      if (!operations.has(String(values[2]))) { operations.add(String(values[2])); rows = [{ step_id: values[2] }]; }
    } else if (text.startsWith('UPDATE storeganise_step_operations')) { /* acknowledgement only */ }
    else if (text.startsWith('UPDATE pay_sessions SET invoice_id=')) {
      Object.assign(session, { invoice_id: values[1], unit_id: values[2], unit_name: values[3], storeganise_context: JSON.parse(String(values[4])) }); rows = [session];
    } else if (text.startsWith('SELECT id FROM pay_sessions WHERE invoice_id=')) rows = [];
    else if (!['BEGIN','COMMIT','ROLLBACK'].includes(text) && !text.includes('pg_advisory_xact_lock') && !text.includes('CREATE TABLE IF NOT EXISTS')) {
      throw new Error(`Unhandled query: ${text}`);
    }
    return { rows: structuredClone(rows), rowCount: rows.length };
  };
  const pool = database(); t.mock.method(pool, 'query', runQuery);
  t.mock.method(pool, 'connect', async () => ({ query: runQuery, release() {} }));
  t.mock.method(globalThis, 'fetch', async (url: string | URL | Request, init?: RequestInit) => {
    const target = new URL(String(url)); assert.equal(target.origin, origin, 'No bank, portal or external service');
    const path = target.pathname.replace('/api/v1/admin', ''); const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    if (method !== 'GET' && !path.endsWith('/previewInvoice')) writes.push({ path, body });
    if (path === `/jobs/${jobId}` && method === 'GET') return Response.json({ id: jobId, ownerId: state.jobOwner,
      type: 'unit_moveIn', state: 'ready', steps, result: { siteId, unitId, unitTypeId: typeId, orderState: state.orderState,
        ...(state.invoiceExists ? { invoiceId, unitRentalId: rentalId } : {}) } });
    if (path === `/jobs/${jobId}/operations/previewInvoice`) return Response.json({ total: state.total });
    if (path.startsWith(`/jobs/${jobId}/steps/`) && method === 'PUT') {
      const index = steps.findIndex(step => step.id === path.split('/').at(-1));
      assert.ok(index >= 0); assert.equal(steps[index].state, 'ready'); assert.deepEqual(body, { state: 'completed' });
      steps[index].state = 'completed'; if (steps[index+1]) steps[index+1].state = 'ready';
      if (index === 0) state.orderState = 'submitted';
      if (index === 1 && !state.createInvoiceDelay) state.invoiceExists = true;
      if (index === 3 && !state.wrongAssignment) state.unitState = 'occupied';
      if (state.stepTimeout === steps[index].id) { state.stepTimeout = ''; throw new Error('response lost after applying step'); }
      return Response.json({});
    }
    if (path === `/invoices/${invoiceId}/payments` && method === 'POST') {
      assert.equal(state.invoiceExists, true); assert.equal(state.balance, 199);
      state.payments.push({ ...body, id: 'sg-payment' }); state.balance = 0;
      if (state.paymentTimeout) { state.paymentTimeout = false; throw new Error('response lost after payment applied'); }
      return Response.json({});
    }
    if (path === `/invoices/${invoiceId}`) return Response.json({ id: invoiceId, owner: { id: owner }, unitRentalId: rentalId,
      siteId, currency: 'USD', state: state.balance === 0 ? 'paid' : 'sent', balance: state.balance, total: state.total, payments: state.payments });
    if (path === `/unit-rentals/${rentalId}`) return Response.json({ id: rentalId, ownerId: owner, unitId, siteId, state: 'active', moveInJobId: jobId });
    if (path === `/units/${unitId}`) return Response.json({ id: unitId, name: 'A1', siteId, state: state.unitState, ownerId: state.unitOwner, rentalId });
    throw new Error(`Unexpected call: ${method} ${path}`);
  });
  t.after(async () => { await closeDatabase(); for (const [key,value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  } });
  const approve = () => finishAttempt('attempt', { status: 'succeeded', transactionId: 'sandbox-confirmed', gatewayStatus: 'AUTHORIZED' });
  return { session, state, steps, writes, approve };
}

test('approved sandbox reservation records the exact USD balance and completes real occupancy once', async t => {
  const f = fixture(t); await f.approve();
  assert.equal(f.state.queued, true); assert.equal(publicSession(f.session).storeganise?.status, 'pending');
  await Promise.all([syncStoreganiseSession(f.session.id), syncStoreganiseSession(f.session.id)]);
  assert.equal(f.session.storeganise_status, 'active'); assert.equal(f.state.unitState, 'occupied');
  assert.equal(f.session.invoice_id, invoiceId); assert.equal(f.session.storeganise_payment_id, 'sg-payment');
  assert.equal(f.state.payments.length, 1); assert.equal(f.state.payments[0].amount, 199);
  assert.equal(f.state.payments[0].method, 'card'); assert.match(f.state.payments[0].notes, /SANDBOX/);
  assert.match(f.state.payments[0].notes, /HNL 5273\.50/);
  assert.equal(f.session.storeganise_context?.sandboxActivation, 'live-storeganise-v1');
  assert.deepEqual(f.writes.map(w => w.path.split('/').at(-1)), ['submit','confirm','payments','invoice','occupy']);
  await syncStoreganiseSession(f.session.id); await f.approve();
  assert.equal(f.state.payments.length, 1); assert.equal(f.writes.length, 5);
  await assert.rejects(repeatSandboxPayment(f.session, 'sandbox-confirmed'), /REPEAT_DISABLED/);
});

test('declines, pending outcomes and partial captures never register payment or occupy a unit', async t => {
  for (const status of ['declined','pending','unknown']) await t.test(status, async st => {
    const f = fixture(st);
    await finishAttempt('attempt', { status: status as 'declined' | 'pending' | 'unknown', transactionId: 'not-paid', gatewayStatus: 'AUTHORIZED_CAPTURE_FAILED' });
    await syncStoreganiseSession(f.session.id);
    assert.equal(f.state.queued, false); assert.equal(f.writes.length, 0);
    await assert.rejects(bindPaidReservation(f.session), /PAYMENT_NOT_CONFIRMED/);
  });
});

test('legacy sandbox receipts cannot be promoted by changing the activation flag', async t => {
  const f = fixture(t); delete f.session.storeganise_context!.sandboxActivation;
  assert.equal(storeganisePaymentWritesAllowed(f.session), false);
  await f.approve(); await syncStoreganiseSession(f.session.id);
  assert.equal(f.state.queued, false); assert.equal(f.writes.length, 0);
  assert.equal(publicSession(f.session).storeganise?.status, 'sandbox_only');
});

test('a lost payment response is read back without registering the payment again', async t => {
  const f = fixture(t); f.state.paymentTimeout = true; await f.approve();
  await syncStoreganiseSession(f.session.id);
  assert.equal(f.session.storeganise_status, 'review'); assert.equal(f.state.payments.length, 1);
  await syncStoreganiseSession(f.session.id);
  assert.equal(f.session.storeganise_status, 'active'); assert.equal(f.state.payments.length, 1);
});

test('a lost confirmation response resumes from the observed job without repeating its write', async t => {
  const f = fixture(t); f.state.stepTimeout = 'confirm'; await f.approve();
  await syncStoreganiseSession(f.session.id); await syncStoreganiseSession(f.session.id);
  assert.equal(f.session.storeganise_status, 'active');
  assert.equal(f.writes.filter(w => w.path.endsWith('/confirm')).length, 1);
});

test('foreign ownership, abandoned reservations and changed totals cannot be activated', async t => {
  for (const fault of ['owner','abandoned','total']) await t.test(fault, async st => {
    const f = fixture(st); await f.approve();
    if (fault === 'owner') f.state.jobOwner = '100000000000000000000002';
    if (fault === 'abandoned') f.state.orderState = 'abandoned';
    if (fault === 'total') f.state.total = 200;
    await syncStoreganiseSession(f.session.id);
    assert.equal(f.session.storeganise_status, 'review'); assert.equal(f.writes.length, 0);
  });
});

test('unknown steps are not skipped and an unconfirmed assignment never shows active', async t => {
  const f = fixture(t); f.steps[3].type = 'identity_verify'; await f.approve();
  await syncStoreganiseSession(f.session.id);
  assert.equal(f.session.storeganise_status, 'awaiting_move_in'); assert.equal(f.state.payments.length, 1);
  assert.equal(f.writes.some(w => w.path.endsWith('/occupy')), false);
  f.steps[3].type = 'confirm_occupy'; f.state.wrongAssignment = true;
  await syncStoreganiseSession(f.session.id);
  assert.equal(f.session.storeganise_status, 'awaiting_move_in');
  f.state.unitOwner = '100000000000000000000002';
  await assert.rejects(completePaidMoveIn(f.session), /IDENTITY_MISMATCH/);
});

test('production follows the same paid occupancy path without a sandbox marker', async t => {
  const f = fixture(t); process.env.CYBERSOURCE_ENVIRONMENT = 'production';
  f.session.environment = 'production'; delete f.session.storeganise_context!.sandboxActivation;
  await f.approve(); await syncStoreganiseSession(f.session.id);
  assert.equal(f.session.storeganise_status, 'active'); assert.doesNotMatch(f.state.payments[0].notes, /SANDBOX/);
});
