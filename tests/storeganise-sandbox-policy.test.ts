import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { database, closeDatabase } from '../lib/pay/db';
import { finishAttempt, publicSession } from '../lib/pay/service';
import { assertStoreganiseEnabled } from '../lib/storeganise/config';
import { isLiveStoreganiseSandbox, storeganisePaymentWritesAllowed } from '../lib/storeganise/payment-policy';
import { syncStoreganiseSession } from '../lib/storeganise/sync';
import type { SessionRow } from '../lib/pay/types';

const origin = 'https://unit-test.storeganise.com';

/** All DB/network boundaries are mocked. Never loads .env.local or calls a provider. */
function fixture(t: TestContext) {
  const env = { DATABASE_URL: 'postgresql://test:test@127.0.0.1:1/unused',
    STOREGANISE_PAY_ENABLED: 'true', STOREGANISE_API_URL: origin + '/api/v1/admin', STOREGANISE_API_KEY: 'unit-test-key',
    CYBERSOURCE_ENVIRONMENT: 'sandbox', STOREGANISE_LIVE_SANDBOX_ENABLED: 'true' };
  const previous = Object.fromEntries(Object.keys(env).map(key => [key, process.env[key]]));
  Object.assign(process.env, env);
  const session: SessionRow = { id: 'test-session', event_id: 'test-event', launch_hash: 'unused',
    customer_id: '100000000000000000000001', unit_id: '200000000000000000000001',
    client_name: 'Test Customer', unit_name: 'Test Unit', concept: 'Test payment', currency: 'HNL', amount: '5273.50',
    reference_usd_amount: '199.00', usd_hnl_rate: '26.5', environment: 'sandbox', is_demo: false,
    bill_to: { firstName: 'Test', lastName: 'Customer', email: 'user@example.test', address1: 'Test', locality: 'Test', country: 'HN', postalCode: '34101' },
    checkout_source: 'storeganise', status: 'processing', portal_status: 'disabled', storeganise_status: 'sandbox_only',
    created_at: new Date(), expires_at: new Date(Date.now() + 60000),
    storeganise_context: { kind: 'reservation', apiOrigin: origin, customerId: '100000000000000000000001',
      unitId: '200000000000000000000001', siteId: '300000000000000000000001' } };
  const state = { queued: 0, deliveryStatus: 'pending', attemptStatus: 'processing' };
  const runQuery = async (sql: string, values: unknown[] = []) => {
    const text = sql.trim();
    let rows: unknown[] = [];
    if (text.startsWith('SELECT session_id,status,payment_mode FROM pay_attempts')) rows = [{ session_id: session.id, status: state.attemptStatus, payment_mode: 'payment' }];
    else if (text.startsWith('SELECT * FROM pay_sessions WHERE id=')) rows = [session];
    else if (text.startsWith('SELECT id FROM pay_attempts WHERE session_id=')) rows = [{ id: 'test-attempt' }];
    else if (text.startsWith('UPDATE pay_attempts SET status=')) { state.attemptStatus = String(values[1]); rows = [{ session_id: session.id }]; }
    else if (text.startsWith('UPDATE pay_sessions SET status=')) {
      session.status = String(values[1]); session.gateway_transaction_id = String(values[2]); session.paid_at = new Date();
    } else if (text.startsWith('INSERT INTO storeganise_deliveries')) state.queued++;
    else if (text.startsWith("UPDATE pay_sessions SET storeganise_status='pending'")) session.storeganise_status = 'pending';
    else if (text.startsWith('UPDATE storeganise_deliveries d SET lease_token=')) {
      rows = [{ session_id: session.id, transaction_id: 'test-transaction', attempt_count: 1, payment_write_started: false, lease_token: values[1] }];
    } else if (text.startsWith('UPDATE storeganise_deliveries SET status=')) {
      state.deliveryStatus = String(values[2]); rows = [{ session_id: session.id }];
    } else if (text.startsWith('UPDATE pay_sessions SET storeganise_status=$2')) session.storeganise_status = String(values[1]);
    else if (!['BEGIN', 'COMMIT', 'ROLLBACK'].includes(text) && !text.includes('CREATE TABLE IF NOT EXISTS')) throw new Error(`Unhandled query: ${text}`);
    return { rows: structuredClone(rows), rowCount: rows.length };
  };
  const pool = database();
  t.mock.method(pool, 'query', runQuery);
  t.mock.method(pool, 'connect', async () => ({ query: runQuery, release() {} }));
  const network = t.mock.method(globalThis, 'fetch', async () => { throw new Error('No external request is allowed'); });
  t.after(async () => {
    await closeDatabase();
    for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  });
  return { session, state, network };
}

test('mixed mode requires opt-in; regular production and isolated sandbox stay available', t => {
  fixture(t);
  assert.equal(assertStoreganiseEnabled().liveSandbox, true);
  process.env.STOREGANISE_LIVE_SANDBOX_ENABLED = 'false';
  assert.throws(assertStoreganiseEnabled, /SANDBOX_INSTANCE_REQUIRED/);
  process.env.CYBERSOURCE_ENVIRONMENT = 'production';
  assert.equal(assertStoreganiseEnabled().liveSandbox, false);
  process.env.STOREGANISE_API_URL = 'https://unit-test.storeganise.dev/api/v1/admin';
  assert.throws(assertStoreganiseEnabled, /INSTANCE_ENVIRONMENT_MISMATCH/);
  process.env.CYBERSOURCE_ENVIRONMENT = 'sandbox';
  assert.equal(assertStoreganiseEnabled().liveSandbox, false);
});

test('write policy uses the saved environment and origin, not current feature flags', t => {
  const { session } = fixture(t);
  assert.equal(isLiveStoreganiseSandbox(session), true);
  assert.equal(storeganisePaymentWritesAllowed(session), false);
  process.env.CYBERSOURCE_ENVIRONMENT = 'production';
  process.env.STOREGANISE_LIVE_SANDBOX_ENABLED = 'false';
  assert.equal(storeganisePaymentWritesAllowed(session), false);
  for (const apiOrigin of ['https://evil.example', 'https://unit-test.storeganise.com.evil.example', 'https://unit-test.storeganise.dev@evil.example', 'https://unit-test.storeganise.dev:8443', 'http://unit-test.storeganise.dev', origin + '/path', 'invalid']) {
    session.storeganise_context!.apiOrigin = apiOrigin;
    assert.equal(storeganisePaymentWritesAllowed(session), false);
  }
});

test('sandbox approval for a live booking saves its receipt but never queues a real payment', async t => {
  const { session, state, network } = fixture(t);
  const completed = await finishAttempt('test-attempt', { status: 'succeeded', transactionId: 'test-transaction', gatewayStatus: 'AUTHORIZED' });
  assert.equal(completed.status, 'succeeded'); assert.equal(state.queued, 0);
  const result = publicSession(completed);
  assert.equal(result.receipt?.transactionId, 'test-transaction'); assert.equal(result.storeganise?.status, 'sandbox_only');
  session.storeganise_status = 'active'; // Stale persisted metadata cannot claim a real activation.
  assert.equal(publicSession(session).storeganise?.status, 'sandbox_only');
  assert.equal(network.mock.callCount(), 0);
});

test('production approvals and sandbox approvals for a test instance still queue their deliveries', async t => {
  const { session, state } = fixture(t);
  session.environment = 'production'; session.storeganise_status = 'waiting_payment';
  await finishAttempt('test-attempt', { status: 'succeeded', transactionId: 'production-transaction', gatewayStatus: 'AUTHORIZED' });
  assert.equal(state.queued, 1); assert.equal(session.storeganise_status, 'pending');
  session.environment = 'sandbox'; session.storeganise_context!.apiOrigin = 'https://unit-test.storeganise.dev';
  session.status = 'processing'; state.attemptStatus = 'processing';
  await finishAttempt('test-attempt', { status: 'succeeded', transactionId: 'sandbox-transaction', gatewayStatus: 'AUTHORIZED' });
  assert.equal(state.queued, 2);
});

test('legacy sandbox queue is stopped before external calls, including after switching to production', async t => {
  const { session, state, network } = fixture(t);
  session.status = 'succeeded'; session.storeganise_status = 'pending'; session.gateway_transaction_id = 'test-transaction';
  process.env.CYBERSOURCE_ENVIRONMENT = 'production';
  process.env.STOREGANISE_LIVE_SANDBOX_ENABLED = 'false';
  await syncStoreganiseSession(session.id);
  assert.equal(state.deliveryStatus, 'sandbox_only'); assert.equal(session.storeganise_status, 'sandbox_only');
  assert.equal(network.mock.callCount(), 0);
});
