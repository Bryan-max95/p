'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import { SecureCardFields, type SecureCardHandle } from './secure-card-fields';
import { BillingDetailsFields, readBillingDetails } from './billing-details-fields';

interface Session { id: string; purpose: 'payment_method'; clientName: string; status: string; returnUrl: string }
async function request<T>(body?: unknown): Promise<T> {
  const id = window.sessionStorage.getItem('pay-method-session-id');
  const response = await fetch('/api/pay/payment-method', { method: body === undefined ? 'GET' : 'POST',
    credentials: 'same-origin', cache: 'no-store', headers: { ...(id ? { 'x-pay-method-session': id } : {}),
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(65000) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? 'PAYMENT_METHOD_UNAVAILABLE');
  return result;
}

/** Account-only carousel. No reservation endpoint, amount or payment operation is used here. */
export default function PaymentMethodCarousel() {
  const [session, setSession] = useState<Session | null>(null);
  const [step, setStep] = useState(1);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const card = useRef<SecureCardHandle>(null);
  const initial = useRef<Promise<{ session: Session }> | null>(null);
  const submitting = useRef(false);
  const contextRequest = useCallback(() => request<{ captureContext: string; clientLibrary: string; clientLibraryIntegrity: string }>({ operation: 'capture-context' }), []);
  useEffect(() => {
    if (session?.status !== 'saved') return;
    const timer = window.setTimeout(() => window.location.assign(session.returnUrl), 5000);
    return () => window.clearTimeout(timer);
  }, [session]);
  useEffect(() => {
    let active = true;
    if (!initial.current) {
      const url = new URL(window.location.href), token = url.searchParams.get('session');
      url.searchParams.delete('session');
      window.history.replaceState(null, '', url.pathname + url.search);
      if (token) window.sessionStorage.removeItem('pay-method-session-id');
      initial.current = token ? request({ operation: 'exchange', token }) : request();
    }
    initial.current.then(result => {
      if (!active) return;
      window.sessionStorage.setItem('pay-method-session-id', result.session.id);
      setSession(result.session);
      if (result.session.status === 'saved') setStep(3);
    }).catch(() => { if (active) setError('El enlace venció o no es válido. Vuelve a tu cuenta y abre Añadir método de pago nuevamente.'); });
    return () => { active = false; };
  }, []);
  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current || !ready || !card.current) return;
    const form = event.currentTarget;
    submitting.current = true; setBusy(true); setError('');
    try {
      const values = new FormData(form);
      const token = await card.current.tokenize(String(values.get('month')), String(values.get('year')));
      const result = await request<{ session: Session }>({ operation: 'save', token, billTo: readBillingDetails(form) });
      setSession(result.session); setStep(3);
    } catch {
      // Recover a completed registration if only its HTTP response was lost.
      try {
        const result = await request<{ session: Session }>();
        setSession(result.session);
        if (result.session.status === 'saved') { setStep(3); return; }
        setError(['registering', 'uncertain'].includes(result.session.status)
          ? 'Estamos verificando el registro. No vuelvas a enviar la tarjeta; vuelve a Billing para consultar su estado.'
          : 'No se pudo guardar la tarjeta. Revisa los datos e inténtalo nuevamente. Si continúa, comunícate con Roatan Self Storage.');
      } catch { setError('No se pudo confirmar el registro. Vuelve a Billing para revisar tus métodos de pago.'); }
    } finally { submitting.current = false; setBusy(false); }
  }
  return <main className="min-h-screen bg-slate-50 px-4 py-8 text-slate-800">
    <div className="mx-auto max-w-2xl space-y-5">
      <header className="text-center space-y-3">
        <Image src="/roatan-logo.svg" alt="Roatan Self Storage" width={80} height={80} className="mx-auto rounded-xl" />
        <h1 className="text-3xl font-extrabold text-[#112a52]">Añadir método de pago</h1>
        <p>Guarda tu tarjeta de forma segura en Roatan Self Storage.</p>
        <Image src="https://www.baccredomatic.com/themes/custom/bac_theme/images/logo.png" alt="BAC Credomatic" width={132} height={40} className="mx-auto" unoptimized />
      </header>
      <section id="card-payment-carousel" className="rounded-3xl border border-slate-200 bg-white p-6 sm:p-9 shadow-xl space-y-6">
        <nav aria-label="Pasos" className="flex justify-between border-b pb-4 text-sm font-bold">
          {['1. Mi cuenta', '2. Tarjeta', '3. Confirmación'].map((label, index) => <span key={label} aria-current={step === index + 1 ? 'step' : undefined} className={step >= index + 1 ? 'text-[#1F5C4F]' : 'text-slate-400'}>{label}</span>)}
        </nav>
        {error && <p role="alert" className="rounded-xl bg-red-50 p-4 text-red-800">{error}</p>}
        {!session && !error && <p role="status">Abriendo tu sesión segura…</p>}
        {session && step === 1 && <div className="space-y-5">
          <h2 className="text-xl font-bold">Confirma tu cuenta</h2><p>{session.clientName}</p>
          <p>Este proceso guarda una tarjeta. No cobra ni modifica una reserva. Tu banco puede verificar la tarjeta mediante una autorización de importe cero.</p>
          <button type="button" onClick={() => setStep(2)} className="w-full rounded-xl bg-[#1F5C4F] p-3 font-bold text-white">Continuar a datos de tarjeta</button>
        </div>}
        {session && step === 2 && <form onSubmit={save} className="space-y-5">
          <h2 className="text-xl font-bold">Información de tarjeta</h2>
          <SecureCardFields ref={card} contextRequest={contextRequest} language="es" numberLabel="Número de tarjeta" securityLabel="CVV" onReady={setReady} onBrand={() => {}}
            expiration={<div><label className="text-xs font-bold" htmlFor="method-month">Vencimiento</label><div className="flex gap-2">
              <input id="method-month" name="month" aria-label="Mes de vencimiento" placeholder="MM" pattern="0[1-9]|1[0-2]" maxLength={2} required autoComplete="cc-exp-month" className="w-16 rounded-lg border p-2" />
              <input name="year" aria-label="Año de vencimiento" placeholder="AAAA" pattern="20[0-9]{2}" maxLength={4} required autoComplete="cc-exp-year" className="w-24 rounded-lg border p-2" />
            </div></div>}><p className="text-xs text-slate-500">Visa, Mastercard y American Express</p></SecureCardFields>
          <BillingDetailsFields language="es" />
          <label className="flex gap-2 text-sm"><input type="checkbox" required />Autorizo guardar esta tarjeta como método de pago. No se cobrará una reserva.</label>
          <button disabled={!ready || busy || session.status !== 'open'} className="w-full rounded-xl bg-[#1F5C4F] p-3 font-bold text-white disabled:opacity-50">{busy ? 'Guardando tarjeta…' : 'Guardar tarjeta'}</button>
          <button type="button" disabled={busy} onClick={() => setStep(1)}>Volver a mi cuenta</button>
        </form>}
        {session && step === 3 && <div className="space-y-4 text-center" role="status"><h2 className="text-2xl font-bold text-emerald-800">Tarjeta guardada</h2><p>Tu método de pago está registrado. Volverás a Billing en 5 segundos.</p><p>No se cobró ninguna reserva.</p></div>}
        {session && <a href={session.returnUrl} rel="noreferrer" className="block text-center font-bold text-[#1F5C4F] underline">Volver a Billing</a>}
        <p className="text-xs text-center text-slate-500">Los campos de tarjeta están protegidos por CyberSource. No guardamos el número completo ni el CVV.</p>
      </section>
    </div>
  </main>;
}
