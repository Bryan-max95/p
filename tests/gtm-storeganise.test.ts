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
function browser(options: { origin?: string; step?: string; failureStatus?: number; changedUser?: boolean; unsafeDestination?: boolean } = {}) {
  const origin = options.origin ?? 'https://booking.roatanselfstorage.com';
  const href = `${origin}/sites/roatan/h-medium?orderId=${orderId}&step=${options.step ?? 'billing'}`;
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
        return Response.json({ id: options.changedUser && userReads === 2 ? '100000000000000000000002' : userId,
          customFields: userReads === 2 ? { pay_checkout_bridge: JSON.stringify({ version: 1, grants: [grant] }) } : {} });
      }
      assert.equal(url, `${pay}/api/storeganise/bridge`, 'No native billing/custom call');
      if (payload.operation === 'prepare') return Response.json({ prepared: true });
      assert.equal(payload.operation, 'redeem');
      return Response.json({ url: `${options.unsafeDestination ? 'https://evil.example' : pay}/?session=${'b'.repeat(43)}` });
    },
  });
  vm.runInContext(source, context);
  let prevented = 0;
  const button = { disabled: false, textContent: 'Add payment method',
    getAttribute: (name: string) => name === 'href' ? `/api/v1/billing/custom?orderId=${orderId}` : null };
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
