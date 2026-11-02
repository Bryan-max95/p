import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { database, closeDatabase } from '../lib/pay/db';
import { createCheckoutSession, beginAttempt, publicSession } from '../lib/pay/service';
import { currentBchRate } from '../lib/pay/exchange-rate';
import crypto from 'node:crypto';
import { chargeDisclosure } from '../lib/pay/amount-display';
import { browserManualInput, browserManualSchema, manualPaymentEnabled, openBrowserManualAccess } from '../lib/pay/browser-manual';
import type { SessionRow } from '../lib/pay/types';
import type { BchRate } from '../lib/pay/bch';
import { manualCheckoutInput } from '../lib/pay/manual-checkout';


/** In-memory DB boundary: exercises actual session/cache logic without external writes. */
function fixture(t: TestContext) {
  const env = { DATABASE_URL: 'postgresql://test:test@127.0.0.1:1/unused', BCH_API_KEY: 'private-unit-test',
    CYBERSOURCE_ENVIRONMENT: 'production', CYBERSOURCE_MERCHANT_ID: 'unit-configured-merchant',
    CYBERSOURCE_KEY_ID: '9b3e9b91-36d0-4d02-b24a-2145570032ea', CYBERSOURCE_SHARED_SECRET: Buffer.alloc(32, 7).toString('base64'),
    PAY_PUBLIC_URL: 'https://pay.example.com', PAY_SESSION_TOKEN_SECRET: 'unit-test-session-secret-with-more-than-32-chars',
    PAY_MANUAL_ENABLED: 'true' };
  const old = Object.fromEntries(Object.keys(env).map(key => [key, process.env[key]]));
  Object.assign(process.env, env);
  const sessions = new Map<string, SessionRow>();
  const state = { cache: undefined as BchRate | undefined, inserts: 0, attempts: 0, requests: 0, rate: 26.5, unavailable: false };
  const runQuery = async (sql: string, values: unknown[] = []) => {
    let rows: unknown[] = [];
    if (sql.startsWith('SELECT rate FROM pay_exchange_rates')) rows = state.cache ? [{ rate: state.cache }] : [];
    else if (sql.startsWith('INSERT INTO pay_exchange_rates')) state.cache = JSON.parse(String(values[0]));
    else if (sql.startsWith('SELECT * FROM pay_sessions WHERE event_id=')) rows = [...sessions.values()].filter(s => s.event_id === values[0]);
    else if (sql.startsWith('SELECT * FROM pay_sessions WHERE id=')) rows = [...sessions.values()].filter(s => s.id === values[0]);
    else if (sql.startsWith('INSERT INTO pay_sessions')) {
      const oldSession = [...sessions.values()].find(s => s.event_id === values[1]);
      if (oldSession) rows = [oldSession];
      else {
        const row = { id: String(values[0]), event_id: String(values[1]), launch_hash: String(values[2]),
          customer_id: String(values[3]), order_id: values[4], invoice_id: values[5], unit_id: String(values[6]),
          client_name: String(values[7]), unit_name: String(values[8]), concept: String(values[9]), currency: String(values[10]),
          amount: String(values[11]), bill_to: JSON.parse(String(values[12])), return_url: values[13], is_demo: values[14],
          portal_status: values[15], reference_usd_amount: values[16], usd_hnl_rate: values[17], fx_source: values[18],
          fx_rate_date: values[19], fx_fetched_at: values[20] ? new Date(String(values[20])) : null,
          storeganise_context: values[23] ? JSON.parse(String(values[23])) : null, storeganise_status: String(values[24]),
          status: 'open', environment: values[21], checkout_source: values[22], created_at: new Date(), expires_at: new Date(Date.now() + 1800000) } as SessionRow;
        sessions.set(row.id, row); state.inserts++; rows = [row];
      }
    } else if (sql.startsWith('UPDATE pay_sessions SET access_hash=$2,')) {
      const row = [...sessions.values()].find(s => s.launch_hash === values[0] && s.environment === 'production' &&
        s.checkout_source === 'manual' && s.event_id.startsWith('browser-manual-production-') && !s.storeganise_context && !s.is_demo && s.expires_at.getTime() > Date.now() &&
        (s.access_hash === values[1] || (!s.access_hash && s.status === 'open')));
      if (row) { row.access_hash = String(values[1]); row.consumed_at ??= new Date(); rows = [row]; }
    } else if (sql.startsWith('UPDATE pay_sessions SET bill_to=')) {
      sessions.get(String(values[0]))!.bill_to = JSON.parse(String(values[1]));
    } else if (sql.startsWith('SELECT count(*)::int n FROM pay_attempts')) rows = [{ n: state.attempts }];
    else if (sql.startsWith("UPDATE pay_sessions SET status='processing'")) sessions.get(String(values[0]))!.status = 'processing';
    else if (sql.startsWith('INSERT INTO pay_attempts')) state.attempts++;
    else if (!['BEGIN', 'COMMIT', 'ROLLBACK'].includes(sql) && !sql.includes('pg_advisory_xact_lock') && !sql.includes('CREATE TABLE IF NOT EXISTS')) {
      throw new Error(`Unhandled test query: ${sql}`);
    }
    return { rows: structuredClone(rows), rowCount: rows.length };
  };
  const pool = database();
  t.mock.method(pool, 'query', runQuery);
  t.mock.method(pool, 'connect', async () => ({ query: runQuery, release() {} }));
  t.mock.method(globalThis, 'fetch', async (url: string | URL | Request) => {
    assert.equal(new URL(String(url)).hostname, 'bchapi-am.azure-api.net');
    state.requests++;
    if (state.unavailable) return new Response('unavailable', { status: 503 });
    const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Tegucigalpa' }).format(new Date());
    return new Response(JSON.stringify([{ IndicadorId: 97, Fecha: `${date}T00:00:00Z`, Valor: state.rate }]));
  });
  t.after(async () => {
    await closeDatabase();
    for (const [key, value] of Object.entries(old)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  });
  return { sessions, state };
}


const billTo = { firstName: 'Manual', lastName: 'Client', email: 'client@example.com', address1: 'One Street',
  locality: 'Roatan', postalCode: '34101', country: 'HN' };
const draft = () => ({ reference: crypto.randomUUID(), clientName: 'Manual Client', unitName: '', amount: '99.00' });

test('public manual entry requires production, is enabled by default and can be disabled', t => {
  fixture(t);
  assert.equal(manualPaymentEnabled(), true);
  delete process.env.PAY_MANUAL_ENABLED; assert.equal(manualPaymentEnabled(), true);
  process.env.PAY_MANUAL_ENABLED = 'false'; assert.equal(manualPaymentEnabled(), false);
  assert.throws(() => browserManualInput(draft()), /DISABLED/);
  process.env.PAY_MANUAL_ENABLED = 'true'; process.env.CYBERSOURCE_ENVIRONMENT = 'sandbox';
  assert.equal(manualPaymentEnabled(), false);
});

test('manual input cannot inject a reservation, card, currency or invented billing details', t => {
  fixture(t);
  const details = draft(), input = browserManualInput(details);
  assert.equal(input.source, 'manual'); assert.equal(input.currency, 'USD');
  assert.equal(input.storeganiseContext, undefined); assert.equal(input.invoiceId, undefined);
  assert.equal(input.billTo.email, ''); assert.equal(input.billTo.address1, '');
  assert.equal(input.unitName, 'Pago manual'); assert.equal(input.isTest, false);
  for (const extra of [{ amount: '0.00' }, { amount: '-1.00' }, { amount: '1.001' }, { amount: '1e2' },
    { amount: '100000000.00' }, { currency: 'HNL' }, { source: 'storeganise' }, { customerId: 'forged' },
    { storeganiseContext: {} }, { invoiceId: 'forged' }, { cardNumber: '4111111111111111' }, { billTo }]) {
    assert.equal(browserManualSchema.safeParse({ ...details, ...extra }).success, false);
  }
});

test('manual preparation creates a USD session without payment and requires actual billing before 3DS', async t => {
  const { sessions, state } = fixture(t);
  const created = await createCheckoutSession(browserManualInput(draft())), row = sessions.get(created.id)!;
  assert.equal(row.currency, 'USD'); assert.equal(row.amount, '99.00');
  assert.equal(row.reference_usd_amount, '99.00'); assert.equal(row.usd_hnl_rate, '26.500000');
  assert.equal(row.storeganise_context, null); assert.equal(row.storeganise_status, 'disabled');
  assert.equal(row.portal_status, 'disabled'); assert.equal(state.attempts, 0);
  const view = publicSession(row);
  assert.equal(view.billingRequired, true); assert.equal(view.storeganise, undefined);
  assert.equal(view.priceReference?.hnlAmount, '2623.50');
  await assert.rejects(beginAttempt(row.id), /email|address1|country/);
  assert.equal(state.attempts, 0);
  const attempt = await beginAttempt(row.id, 'fake-token', 'payment', billTo);
  assert.deepEqual(attempt.session.bill_to, billTo);
  assert.equal(attempt.session.amount, '99.00'); assert.equal(attempt.session.currency, 'USD');
  assert.equal(state.attempts, 1);
  await assert.rejects(beginAttempt(row.id, 'another-token', 'payment', billTo), /already active/);
});

test('BCH changes update the reference equivalent, never the USD charge or an existing session', async t => {
  const { sessions, state } = fixture(t);
  const input = browserManualInput(draft()), a = await createCheckoutSession(input);
  state.rate = 27; state.cache!.fetchedAt = new Date(Date.now() - 3600001).toISOString();
  const b = await createCheckoutSession(browserManualInput(draft()));
  assert.equal(sessions.get(a.id)!.amount, '99.00'); assert.equal(sessions.get(b.id)!.amount, '99.00');
  assert.equal(publicSession(sessions.get(a.id)!).priceReference?.hnlAmount, '2623.50');
  assert.equal(publicSession(sessions.get(b.id)!).priceReference?.hnlAmount, '2673.00');
  const calls = state.requests; delete process.env.BCH_API_KEY;
  assert.deepEqual(await createCheckoutSession(input), a); assert.equal(state.requests, calls);
  for (const changed of [{ amount: '1.00' }, { clientName: 'Other' }, { unitName: 'Other' }, { source: 'storeganise' as const }]) {
    await assert.rejects(createCheckoutSession({ ...input, ...changed }), /does not match/);
  }
});

test('concurrent retries create one session and recover access without resetting payment or expiry', async t => {
  const { sessions, state } = fixture(t);
  const input = browserManualInput(draft());
  const [a, b] = await Promise.all([createCheckoutSession(input), createCheckoutSession(input)]);
  assert.deepEqual(a, b); assert.equal(state.inserts, 1);
  const row = sessions.get(a.id)!, expires = row.expires_at.getTime();
  const first = await openBrowserManualAccess(a.launchToken), consumed = row.consumed_at!.getTime();
  for (const status of ['open', 'processing', 'pending', 'unknown', 'succeeded']) {
    row.status = status;
    const retry = await openBrowserManualAccess(a.launchToken);
    assert.equal(retry.accessToken, first.accessToken); assert.equal(retry.session.status, status);
    assert.equal(row.expires_at.getTime(), expires); assert.equal(row.consumed_at!.getTime(), consumed);
  }
  assert.equal(state.attempts, 0);
  row.expires_at = new Date(0);
  await assert.rejects(openBrowserManualAccess(a.launchToken), /NOT_RECOVERABLE/);
});

test('manual recovery refuses Storeganise, CLI, sandbox and unrelated sessions', async t => {
  const { sessions } = fixture(t);
  const created = await createCheckoutSession(browserManualInput(draft())), row = sessions.get(created.id)!;
  for (const changed of [{ environment: 'sandbox' }, { checkout_source: 'storeganise' },
    { event_id: 'operator-manual' }, { storeganise_context: { customerId: 'foreign' } }, { access_hash: 'other-access' }]) {
    const original = { ...row };
    Object.assign(row, changed);
    await assert.rejects(openBrowserManualAccess(created.launchToken), /NOT_RECOVERABLE/);
    Object.assign(row, original); delete row.access_hash;
  }
  await assert.rejects(openBrowserManualAccess('x'.repeat(43)), /NOT_RECOVERABLE/);
});

test('CLI USD links still work and manual checkouts cannot have a Storeganise binding', async t => {
  const { sessions, state } = fixture(t);
  await assert.rejects(createCheckoutSession({ ...browserManualInput(draft()), storeganiseContext: {} as never }), /cannot bind/);
  const input = manualCheckoutInput({ reference: 'OPERATOR-1', customerId: 'operator-client', unitId: 'unit-A',
    clientName: 'Client', unitName: 'Unit A', concept: 'Rent', amount: '199.00', billTo });
  const created = await createCheckoutSession(input);
  assert.equal(sessions.get(created.id)!.amount, '199.00'); assert.equal(state.attempts, 0);
  assert.equal(publicSession(sessions.get(created.id)!).billingRequired, false);
});

test('Storeganise input preserves its owner, invoice, USD balance and binding', async t => {
  const { sessions } = fixture(t);
  const binding = { kind: 'invoice' as const, apiOrigin: 'https://store.example.com', customerId: 'customer',
    invoiceId: 'invoice', rentalId: 'rental', unitId: 'unit', siteId: 'site' };
  const created = await createCheckoutSession({ ...browserManualInput(draft()), source: 'storeganise',
    customerId: 'customer', unitId: 'unit', invoiceId: 'invoice', storeganiseContext: binding, billTo });
  const row = sessions.get(created.id)!;
  assert.equal(row.amount, '99.00'); assert.equal(row.currency, 'USD');
  assert.equal(row.customer_id, 'customer'); assert.equal(row.invoice_id, 'invoice');
  assert.deepEqual(row.storeganise_context, binding); assert.equal(row.storeganise_status, 'waiting_payment');
});

test('BCH failures never fabricate an exchange rate or start a charge', async t => {
  const { state } = fixture(t);
  const rate = await currentBchRate();
  assert.deepEqual(await currentBchRate(), rate); assert.equal(state.requests, 1);
  state.cache!.fetchedAt = new Date(Date.now() - 3600001).toISOString(); state.unavailable = true;
  await assert.rejects(createCheckoutSession(browserManualInput(draft())), /BCH_UNAVAILABLE/);
  assert.equal(state.inserts, 0); assert.equal(state.attempts, 0);
});

test('tampered amounts, expired sessions and old HNL sessions cannot start new charges', async t => {
  const { sessions, state } = fixture(t);
  const created = await createCheckoutSession(browserManualInput(draft())), row = sessions.get(created.id)!;
  row.amount = '1.00';
  await assert.rejects(beginAttempt(row.id, undefined, 'payment', billTo), /Invalid stored exchange quote/);
  row.amount = '99.00'; row.expires_at = new Date(0);
  await assert.rejects(beginAttempt(row.id, undefined, 'payment', billTo), /Session expired/);
  row.currency = 'HNL'; row.amount = '2623.50';
  await assert.rejects(beginAttempt(row.id, undefined, 'payment', billTo), /SESSION_CURRENCY_CHANGED/);
  row.status = 'succeeded'; row.gateway_transaction_id = 'historical-transaction';
  const receipt = publicSession(row).receipt!;
  assert.equal(receipt.amount, '2623.50'); assert.equal(receipt.currency, 'HNL'); assert.equal(state.attempts, 0);
  await assert.rejects(createCheckoutSession({ ...browserManualInput(draft()), currency: 'HNL' }), /USD amount/);
});

test('checkout and receipt state USD charged and the informational HNL equivalent', async t => {
  const { sessions } = fixture(t);
  const created = await createCheckoutSession(browserManualInput(draft())), row = sessions.get(created.id)!;
  row.status = 'succeeded'; row.gateway_transaction_id = 'mock-payment';
  const view = publicSession(row), receipt = view.receipt!;
  assert.equal(receipt.amount, '99.00'); assert.equal(receipt.currency, 'USD');
  assert.deepEqual(receipt.priceReference, view.priceReference);
  assert.ok(chargeDisclosure(view.amount, view.currency, view.priceReference, 'es').includes('tarjeta: $ 99.00 USD. Equivalente informativo: L 2623.50 HNL.'));
  assert.ok(chargeDisclosure(receipt.amount, receipt.currency, receipt.priceReference, 'es', true).includes('Cobro realizado: $ 99.00 USD.'));
  assert.ok(chargeDisclosure(receipt.amount, receipt.currency, receipt.priceReference, 'en', true).includes('Amount charged: $ 99.00 USD.'));
});
