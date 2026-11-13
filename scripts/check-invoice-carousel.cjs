// Run against an already running local Pay server: node scripts/check-invoice-carousel.cjs
// All payment/provider requests are intercepted. No card details or real writes.
const { chromium, expect } = require('@playwright/test');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');

(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'msedge' });
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    let status = 'open', sync = 'waiting_payment', charges = 0;
    const returnUrl = 'https://booking.roatanselfstorage.com/account/invoices/USDSERVICE1';
    const reference = { amount: '49.00', currency: 'USD', hnlPerUsd: '26.500000', hnlAmount: '1298.50', source: 'BCH', rateDate: '2026-11-12', indicatorId: 620, rateType: 'sell' };
    const session = () => ({ id: '11ef3b3c-d740-4c81-aad0-0fa520de063e', clientName: 'Test Customer', unitName: 'USDSERVICE1',
      concept: 'Servicio de transporte', amount: '1298.50', currency: 'HNL', priceReference: reference, status, environment: 'production',
      source: 'storeganise', billingRequired: false, storeganise: { status: sync, kind: 'account_invoice', invoiceReference: 'USDSERVICE1', returnUrl },
      ...(status === 'succeeded' ? { receipt: { authCode: 'TEST', transactionId: 'mock-transaction', amount: '1298.50', currency: 'HNL',
        unit: 'USDSERVICE1', client: 'Test Customer', date: new Date().toISOString(), priceReference: reference } } : {}) });
    const library = "window.Flex=function(){return {microform:function(){return {createField:function(){var ready;return {on:function(event,cb){if(event==='load')ready=cb},load:function(){if(ready)ready()},unload:function(){}}},createToken:function(options,cb){cb(null,'mock-token')}}}}};";
    const integrity = 'sha256-' + crypto.createHash('sha256').update(library).digest('base64');
    const apiCalls = [];
    await context.route('**/*', async route => {
      const req = route.request(), url = new URL(req.url());
      if (url.href === 'https://flex.cybersource.com/mock-invoice-ui.js') return route.fulfill({ contentType: 'application/javascript',
        headers: { 'Access-Control-Allow-Origin': '*' }, body: library });
      if (url.href === returnUrl) return route.fulfill({ contentType: 'text/html', body: '<h1>Mock Storeganise invoice</h1>' });
      if (url.origin !== 'http://localhost:3100') return route.abort();
      if (!url.pathname.startsWith('/api/pay/')) return route.continue();
      apiCalls.push(url.pathname);
      if (url.pathname === '/api/pay/capture-context') return route.fulfill({ json: { captureContext: 'mock', clientLibrary: 'https://flex.cybersource.com/mock-invoice-ui.js', clientLibraryIntegrity: integrity } });
      if (url.pathname === '/api/pay/payments') {
        charges++;
        const input = req.postDataJSON(); assert.equal(input.amount, undefined); assert.equal(input.invoiceId, undefined);
        assert.equal(input.confirmReservation, undefined); assert.equal(input.transientToken, 'mock-token');
        status = 'succeeded'; sync = 'pending';
      } else assert.equal(url.pathname, '/api/pay/session');
      return route.fulfill({ json: { session: session() } });
    });
    await page.goto('http://localhost:3100/?session=' + 'a'.repeat(43));
    await expect(page.getByRole('heading', { name: 'Detalles de su factura' })).toBeVisible();
    await expect(page.getByText('Servicio de transporte', { exact: true })).toBeVisible();
    await expect(page.locator('input[value="USDSERVICE1"]')).toBeVisible();
    await expect(page.locator('input[value="49.00"]')).toBeVisible();
    await expect(page.locator('body')).toContainText('1298.50 HNL');
    await page.getByRole('button', { name: 'Continuar a Datos de Tarjeta' }).click();
    await page.getByPlaceholder('NOMBRE COMO APARECE EN LA TARJETA').fill('TEST CUSTOMER');
    await page.getByPlaceholder('MM/AA').fill('1229');
    await page.getByRole('button', { name: /Pagar Ahora/ }).click();
    await expect(page.getByRole('heading', { name: 'Pago confirmado', exact: true })).toBeVisible();
    await expect(page.getByTestId('invoice-status')).toContainText('Estamos registrando');
    await expect(page.getByTestId('invoice-status')).not.toContainText('Factura pagada');
    await expect(page.locator('body')).not.toContainText('bodega habilitada');
    assert.equal(charges, 1);
    sync = 'invoice_paid';
    await page.getByRole('button', { name: 'Actualizar estado' }).click();
    await expect(page.getByTestId('invoice-status')).toContainText('Factura pagada');
    await expect(page.getByText('Volverá a su factura en Storeganise en 5 segundos.')).toBeVisible();
    await page.waitForURL(returnUrl, { timeout: 10000 });
    assert.equal(charges, 1); assert.equal(apiCalls.includes('/api/pay/payment-method'), false);
    console.log('PASS: invoice summary, exact USD/HNL amount, card carousel, pending application, verified invoice paid and return. Providers mocked; no real charge.');
    await context.close();
  } finally { await browser.close(); }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
