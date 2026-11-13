import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';

const source = fs.readFileSync('examples/gtm-storeganise-pago.html', 'utf8').replace(/^<script>\s*/, '').replace(/\s*<\/script>\s*$/, '');
const pay = 'https://www.payroatanselfstorage.com';
const orderId = '200000000000000000000001', userId = '100000000000000000000001';
const grant = { id: '11ef3b3c-d740-4c81-aad0-0fa520de063e', orderId, token: 'a'.repeat(43), expiresAt: new Date(Date.now() + 300000).toISOString() };

/** Minimal browser harness executes the actual tag. It mocks network and DOM,
 * not the tag's parsing or navigation decisions; it starts no application. */
function browser(options: { origin?: string; step?: string; failureStatus?: number; changedUser?: boolean; unsafeDestination?: boolean; v9?: boolean; v10?: boolean; account?: boolean;
  invoice?: boolean; link?: string; label?: string; wrongGrant?: boolean; navigateAway?: boolean } = {}) {
  const origin = options.origin ?? 'https://booking.roatanselfstorage.com';
  const href = options.invoice ? `${origin}/account/invoices/USDSERVICE1?pay&_n=1` : options.account ? `${origin}/account/billing` : `${origin}/sites/roatan/h-medium?orderId=${orderId}&step=${options.step ?? 'billing'}`;
  const listeners = new Map<string, (event: unknown) => void>();
  const elements = new Map<string, Element>();
  class Element {
    id = ''; hidden = false; textContent = ''; innerHTML = ''; tabIndex = 0;
    complete = false; naturalWidth = 100; nonce = 'style-test-nonce';
    private children = new Map<string, Element>();
    setAttribute() {} addEventListener() {} focus() {} remove() {}
    getAttribute(name: string) { return name === 'data-style-nonce' ? 'style-test-nonce' : null; }
    appendChild(child: Element) { if (child.id) elements.set(child.id, child); }
    querySelector(selector: string): Element { if (!this.children.has(selector)) this.children.set(selector, new Element()); return this.children.get(selector)!; }
  }
  const requests: Array<{ url: string; init: RequestInit; payload?: Record<string, string> }> = [];
  const navigations: string[] = [], logs: string[] = [], saved = new Map<string, string>();
  let userReads = 0;
  const win = {
    location: { origin, href, assign(url: string) { navigations.push(url); } },
    crypto: webcrypto, btoa: (s: string) => Buffer.from(s, 'binary').toString('base64'),
    setTimeout, clearTimeout,
    sessionStorage: { getItem: (key: string) => saved.get(key) ?? null, setItem: (key: string, value: string) => saved.set(key, value) },
    addEventListener: (name: string, listener: (event: unknown) => void) => listeners.set(name, listener),
  };
  const context = vm.createContext({ window: win, document: { head: new Element(), body: new Element(), activeElement: new Element(),
    getElementById: (id: string) => elements.get(id) ?? (id === 'app' ? new Element() : null),
    createElement: () => new Element(), querySelector: () => null }, URL, AbortController, Uint8Array,
    console: { warn: (value: string) => logs.push(value) },
    fetch: async (url: string, init: RequestInit) => {
      const payload = init.body ? JSON.parse(String(init.body)) : undefined;
      requests.push({ url, init, payload });
      if (options.failureStatus) return new Response('provider error', { status: options.failureStatus, headers: { 'Retry-After': '60' } });
      if (url === `${origin}/api/v1/user?include=customFields`) {
        userReads++;
        if (options.navigateAway && userReads === 2) win.location.href = `${origin}/account/invoices/DIFFERENT`;
        return Response.json({ id: options.changedUser && userReads === 2 ? '100000000000000000000002' : userId,
          customFields: userReads === 2 ? { pay_checkout_bridge: JSON.stringify({ version: 1, grants: [options.invoice
            ? { ...grant, orderId: undefined, purpose: 'invoice', invoiceRef: options.wrongGrant ? 'different' : 'usdservice1', siteId: '300000000000000000000001' } : options.account
            ? { ...grant, orderId: undefined, purpose: 'payment_method', siteId: '300000000000000000000001' } : grant] }) } : {} });
      }
      assert.equal(url, `${pay}/api/storeganise/bridge`, 'No native billing/custom call');
      if (['prepare','prepare_payment_method','prepare_invoice'].includes(payload.operation)) return Response.json({ prepared: true });
      assert.equal(payload.operation, options.invoice ? 'redeem_invoice' : options.account ? 'redeem_payment_method' : 'redeem');
      return Response.json({ url: `${options.unsafeDestination ? 'https://evil.example' : pay}/?session=${'b'.repeat(43)}${options.account ? '&flow=payment_method' : ''}` });
    },
  });
  vm.runInContext(options.v10 || options.v9 ? fs.readFileSync(`examples/gtm-storeganise-pago-${options.v10 ? 'v10' : 'v9'}.html`, 'utf8').replace(/^<script>\s*/, '').replace(/\s*<\/script>\s*$/, '') : source, context);
  let prevented = 0;
  const button = { disabled: false, textContent: options.label ?? (options.invoice ? 'Pay' : 'Add payment method'),
    getAttribute: (name: string) => name === 'href' ? options.link ?? (options.invoice ? `/api/v1/billing/custom?orderId=&returnUrl=${encodeURIComponent(href)}&siteId=300000000000000000000001` : options.account ? '/api/v1/billing/custom' : `/api/v1/billing/custom?orderId=${orderId}`) : null };
  const click = () => listeners.get('click')?.({ button: 0, target: { nodeType: 1, closest: () => button },
    preventDefault() { prevented++; }, stopImmediatePropagation() {} });
  const settle = async () => { for (let i = 0; i < 20; i++) await new Promise<void>(resolve => setImmediate(resolve)); };
  return { requests, navigations, logs, saved, click, settle, prevented: () => prevented, context };
}

for (const origin of ['https://booking.roatanselfstorage.com', 'https://roatanselfstorage.storeganise.com']) {
  test(`GTM opens Pay from ${origin} using two private profile reads and no native checkout`, async () => {
    const b = browser({ origin }); b.click(); b.click(); await b.settle();
    assert.equal(b.requests.length, 4, 'Repeated click while loading creates no extra request');
    assert.deepEqual(b.requests.map(r => r.init.method), ['GET', 'POST', 'GET', 'POST']);
    assert.equal(b.requests[0].init.credentials, 'same-origin'); assert.equal(b.requests[1].init.credentials, 'omit');
    assert.deepEqual(b.requests[1].payload, { operation: 'prepare', userId, orderId });
    assert.equal(b.requests[3].payload?.grantId, grant.id); assert.equal(b.requests[3].payload?.token, grant.token);
    assert.match(b.requests[3].payload!.clientNonce, /^[A-Za-z0-9_-]{43}$/);
    assert.equal(new URL(b.requests[3].payload!.returnUrl).origin, origin);
    assert.deepEqual(b.navigations, [`${pay}/?session=${'b'.repeat(43)}`]);
    assert.equal(b.logs.length, 0);
    assert.equal([...b.saved.values()].every(value => /^\d+$/.test(value)), true, 'Storage contains cooldown timestamps only');
    vm.runInContext(source, b.context); b.click(); await b.settle();
    assert.equal(b.requests.length, 4, 'Duplicated GTM installation does not add a second listener');
  });
}

test('GTM leaves registration and other domains untouched', async () => {
  for (const options of [{ step: 'account' }, { origin: 'https://evil.example' }]) {
    const b = browser(options); b.click(); await b.settle();
    assert.equal(b.requests.length, 0); assert.equal(b.prevented(), 0);
  }
});

test('GTM rejects profile identity changes and unexpected Pay destinations', async () => {
  const changed = browser({ changedUser: true }); changed.click(); await changed.settle();
  assert.equal(changed.requests.length, 3); assert.equal(changed.navigations.length, 0);
  assert.match(changed.logs[0], /STOREGANISE_IDENTITY_MISMATCH/);
  const unsafe = browser({ unsafeDestination: true }); unsafe.click(); await unsafe.settle();
  assert.equal(unsafe.navigations.length, 0); assert.match(unsafe.logs[0], /INVALID_CHECKOUT_RESPONSE/);
});

for (const status of [401, 403, 404, 429]) {
  test(`GTM stops after HTTP ${status} without automatic retries or a blank redirect`, async () => {
    const b = browser({ failureStatus: status }); b.click(); await b.settle();
    assert.equal(b.requests.length, 1); assert.equal(b.navigations.length, 0);
    assert.match(b.logs[0], new RegExp(`USER_HTTP_${status}`));
    b.click(); await b.settle();
    assert.equal(b.requests.length, 1, 'Cooldown also prevents an immediate manual retry');
  });
}

test('V9 account add-card opens the secure carousel without a site hint or order', async () => {
  const b = browser({ v9: true, account: true }); b.click(); await b.settle();
  assert.equal(b.requests.length, 4);
  assert.deepEqual(b.requests[1].payload, { operation: 'prepare_payment_method', userId });
  assert.equal(b.requests[3].payload?.operation, 'redeem_payment_method');
  assert.equal(b.requests[3].payload?.siteId, '300000000000000000000001');
  assert.equal(b.requests[3].payload?.returnUrl, 'https://booking.roatanselfstorage.com/account/billing');
  assert.equal(b.requests[3].payload?.orderId, undefined);
  assert.deepEqual(b.navigations, [`${pay}/?session=${'b'.repeat(43)}&flow=payment_method`]);
});

test('V9 keeps reservation operations and payment destination unchanged', async () => {
  const b = browser({ v9: true }); b.click(); await b.settle();
  assert.deepEqual(b.requests[1].payload, { operation: 'prepare', userId, orderId });
  assert.equal(b.requests[3].payload?.operation, 'redeem');
  assert.deepEqual(b.navigations, [`${pay}/?session=${'b'.repeat(43)}`]);
});

test('V9 account flow rejects identity changes and unsafe destinations', async () => {
  for (const options of [{ changedUser: true }, { unsafeDestination: true }]) {
    const b = browser({ v9: true, account: true, ...options }); b.click(); await b.settle();
    assert.equal(b.navigations.length, 0);
    assert.equal(b.logs.length, 1);
  }
});

test('V10 pays the invoice from the screenshot with empty orderId and returns without native pay flag', async () => {
  for (const origin of ['https://booking.roatanselfstorage.com', 'https://roatanselfstorage.storeganise.com']) {
    const b = browser({ v10: true, invoice: true, origin }); b.click(); b.click(); await b.settle();
    assert.equal(b.requests.length, 4);
    assert.deepEqual(b.requests[1].payload, { operation: 'prepare_invoice', userId, invoiceRef: 'usdservice1', siteId: '300000000000000000000001' });
    const redeem = b.requests[3].payload!;
    assert.equal(redeem.operation, 'redeem_invoice'); assert.equal(redeem.invoiceRef, 'usdservice1');
    assert.equal(redeem.returnUrl, `${origin}/account/invoices/USDSERVICE1`);
    assert.equal(redeem.orderId, undefined); assert.equal(redeem.amount, undefined);
    assert.deepEqual(b.navigations, [`${pay}/?session=${'b'.repeat(43)}`]);
    assert.equal(b.logs.length, 0);
  }
});

test('V10 accepts a plain invoice Pay button without a site hint, ignoring browser amount', async () => {
  const b = browser({ v10: true, invoice: true, label: 'Pagar ahora', link: '#' }); b.click(); await b.settle();
  assert.deepEqual(b.requests[1].payload, { operation: 'prepare_invoice', userId, invoiceRef: 'usdservice1' });
  assert.equal(b.navigations.length, 1);
});

test('V10 rejects an unrelated invoice grant, changed identity and a foreign checkout URL', async () => {
  for (const options of [{ wrongGrant: true }, { changedUser: true }, { unsafeDestination: true }, { navigateAway: true }]) {
    const b = browser({ v10: true, invoice: true, ...options }); b.click(); await b.settle();
    assert.equal(b.navigations.length, 0);
    if (!options.unsafeDestination) assert.equal(b.requests.length, 3, 'No redemption after mismatched profile or navigation');
  }
});

test('V10 rejects foreign or mismatched invoice return and duplicate site parameters before requests', async () => {
  for (const suffix of ['returnUrl=https://evil.example/account/invoices/USDSERVICE1',
    'returnUrl=/account/invoices/OTHER', 'siteId=300000000000000000000001&siteId=300000000000000000000001']) {
    const b = browser({ v10: true, invoice: true, link: `/api/v1/billing/custom?${suffix}` }); b.click(); await b.settle();
    assert.equal(b.requests.length, 0); assert.match(b.logs[0], /INVOICE_CONTEXT_INVALID/);
  }
});

test('V10 leaves invoice download and unrelated external links alone', async () => {
  for (const options of [{ link: '/invoice.pdf', label: 'Download' }, { link: 'https://evil.example', label: 'Pagar' }]) {
    const b = browser({ v10: true, invoice: true, ...options }); b.click(); await b.settle();
    assert.equal(b.prevented(), 0); assert.equal(b.requests.length, 0);
  }
});

test('V10 preserves reservation prepare/redeem and the corrected Billing card registration', async () => {
  const b = browser({ v10: true }); b.click(); await b.settle();
  assert.deepEqual(b.requests[1].payload, { operation: 'prepare', userId, orderId });
  assert.equal(b.requests[3].payload?.operation, 'redeem'); assert.equal(b.navigations.length, 1);
  for (const link of ['/api/v1/billing/custom', `/api/v1/billing/custom?orderId=${orderId}`]) {
    const card = browser({ v10: true, account: true, link }); card.click(); await card.settle();
    assert.deepEqual(card.requests[1].payload, { operation: 'prepare_payment_method', userId });
    assert.equal(card.requests[3].payload?.operation, 'redeem_payment_method');
    assert.equal(card.requests[3].payload?.orderId, undefined);
    assert.deepEqual(card.navigations, [`${pay}/?session=${'b'.repeat(43)}&flow=payment_method`]);
  }
});

test('V10 delivers exactly the same full script in Markdown', () => {
  const markdown = fs.readFileSync('SCRIPT_GTM_V10_COMPLETO.md', 'utf8');
  assert.equal(markdown.split('```html\n')[1].split('\n```')[0].replace(/\r\n/g, '\n').trim(),
    fs.readFileSync('examples/gtm-storeganise-pago-v10.html', 'utf8').replace(/\r\n/g, '\n').trim());
});
