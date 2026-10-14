'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';

function message(code: string) {
  if (code === 'STOREGANISE_LOGIN_RATE_LIMITED') return 'Se alcanzó el límite de intentos. Espere 15 minutos antes de volver a iniciar sesión.';
  if (code === 'STOREGANISE_CUSTOMER_LOGIN_REQUIRED' || code === 'INVALID_LOGIN') return 'Revise el correo y la contraseña de su cuenta de Storeganise.';
  if (code === 'STOREGANISE_SANDBOX_INSTANCE_REQUIRED') return 'La conexión de reservas todavía está configurada para pruebas. Contacte a Roatan Self Storage para habilitar los pagos de estas reservas.';
  if (code === 'STOREGANISE_PAY_DISABLED' || code === 'STOREGANISE_INSTANCE_ENVIRONMENT_MISMATCH') return 'La conexión de pagos con Storeganise todavía no está habilitada. Contacte a Roatan Self Storage.';
  if (code === 'INVOICE_NOT_PAYABLE' || code === 'ORDER_NOT_ACTIVE') return 'Esta reserva ya no tiene un pago disponible. Consulte el estado de su reserva en Storeganise.';
  if (code === 'STOREGANISE_RESERVATION_TOTAL_UNAVAILABLE') return 'Storeganise todavía no ha calculado el total de esta reserva. Regrese a la reserva para completar los datos pendientes.';
  if (code === 'STOREGANISE_RESERVATION_REFRESH_REQUIRED') return 'La reserva se actualizó. Pulse Continuar para consultar su estado actual.';
  if (code === 'STOREGANISE_RESERVATION_UNAVAILABLE' || code === 'STOREGANISE_IDENTITY_MISMATCH') return 'No se pudo acceder a esta reserva con su cuenta. Use la cuenta con la que hizo la reserva o contacte a Roatan Self Storage.';
  return 'No se pudo conectar con Storeganise. Intente nuevamente. No se ha realizado ningún cobro.';
}

export default function ReservationAccess({ orderId, returnUrl }: { orderId: string; returnUrl: string }) {
  const [busy, setBusy] = useState(true);
  const [loginRequired, setLoginRequired] = useState(false);
  const [error, setError] = useState<string>();
  const initial = useRef<Promise<{ url?: string; error?: string; status: number }> | null>(null);
  const inFlight = useRef(false);

  async function loadReservation() {
    const response = await fetch('/api/storeganise/reservation', {
      method: 'POST', credentials: 'same-origin', cache: 'no-store',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ orderId, returnUrl }),
      signal: AbortSignal.timeout(60_000),
    });
    const data = await response.json();
    return { ...data, status: response.status } as { url?: string; error?: string; status: number };
  }

  function accept(result: { url?: string; error?: string; status: number }) {
    if (result.status === 401) {
      setLoginRequired(true); setBusy(false); return;
    }
    if (result.status >= 400 || !result.url) {
      setError(result.error ?? 'STOREGANISE_RESERVATION_UNAVAILABLE'); setBusy(false); return;
    }
    const target = new URL(result.url);
    if (target.origin !== window.location.origin || target.pathname !== '/' || !/^[A-Za-z0-9_-]{43}$/.test(target.searchParams.get('session') ?? '')) {
      setError('STOREGANISE_RESERVATION_UNAVAILABLE'); setBusy(false); return;
    }
    // Do not retain another customer's carousel session as the active tab session.
    try { window.sessionStorage.removeItem('pay-session-id'); } catch { /* The launch link still identifies this reservation. */ }
    window.location.replace(target.href);
  }

  useEffect(() => {
    let active = true;
    initial.current ??= loadReservation();
    initial.current.then(result => { if (active) accept(result); }).catch(() => {
      if (active) { setBusy(false); setError('STOREGANISE_UNAVAILABLE'); }
    });
    return () => { active = false; };
    // This page is keyed by orderId in the server component. Strict Mode reuses the request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true); setError(undefined);
    const form = event.currentTarget;
    try {
      if (loginRequired) {
        const data = new FormData(form);
        const response = await fetch('/api/storeganise/customer-session', {
          method: 'POST', credentials: 'same-origin', cache: 'no-store',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: data.get('email'), password: data.get('password') }),
          signal: AbortSignal.timeout(30_000),
        });
        const result = await response.json();
        const password = form.elements.namedItem('password');
        if (password instanceof HTMLInputElement) password.value = '';
        if (!response.ok) { setError(response.status === 401 ? 'INVALID_LOGIN' : result.error); setBusy(false); return; }
        setLoginRequired(false);
      }
      accept(await loadReservation());
    } catch { setError('STOREGANISE_UNAVAILABLE'); setBusy(false); }
    finally { inFlight.current = false; }
  }

  async function changeAccount() {
    if (inFlight.current || busy) return;
    setBusy(true);
    try {
      const response = await fetch('/api/storeganise/customer-session', { method: 'DELETE', credentials: 'same-origin' });
      if (!response.ok) throw new Error('Sign out unavailable');
      setLoginRequired(true); setError(undefined);
    } catch { setError('STOREGANISE_UNAVAILABLE'); }
    finally { setBusy(false); }
  }

  return <main className="min-h-screen bg-slate-50 flex items-center justify-center px-6">
    <section className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-7 space-y-5">
      <p className="text-sm font-semibold text-blue-700">Roatan Self Storage · Pay</p>
      <h1 className="text-2xl font-bold text-slate-900">{loginRequired ? 'Confirme su cuenta para pagar' : 'Abrir el pago de su reserva'}</h1>
      <p className="text-sm text-slate-600">{loginRequired
        ? 'Inicie sesión con el correo y la contraseña de su cuenta de Storeganise. Consultaremos su reserva y el total a pagar.'
        : 'Consultaremos los datos y el total de su reserva en Storeganise para preparar el pago.'}</p>
      <form onSubmit={submit} className="space-y-4">
        {loginRequired && <>
          <label className="block text-sm text-slate-700">Correo electrónico
            <input type="email" name="email" autoComplete="username" required maxLength={254} disabled={busy} className="mt-1 w-full rounded-lg border border-slate-300 p-3" />
          </label>
          <label className="block text-sm text-slate-700">Contraseña de Storeganise
            <input type="password" name="password" autoComplete="current-password" required maxLength={1024} disabled={busy} className="mt-1 w-full rounded-lg border border-slate-300 p-3" />
          </label>
        </>}
        {error && <p role="alert" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">{message(error)}</p>}
        <button type="submit" disabled={busy} className="w-full rounded-lg bg-blue-700 py-3 font-semibold text-white disabled:opacity-60">
          {busy ? 'Consultando reserva…' : loginRequired ? 'Iniciar sesión y continuar' : 'Continuar'}
        </button>
      </form>
      {!loginRequired && !busy && <button type="button" onClick={changeAccount} className="text-sm text-blue-700 underline">Usar otra cuenta de Storeganise</button>}
      <a href={returnUrl} rel="noreferrer" className="block text-sm text-blue-700 underline">Volver a Storeganise</a>
    </section>
  </main>;
}
