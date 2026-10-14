'use client';

import { useEffect, useRef, useState } from 'react';
import PayTransition from './pay-transition';

function message(code: string) {
  if (code === 'STOREGANISE_CUSTOMER_LOGIN_REQUIRED') return 'Abre el pago desde tu reserva en Storeganise para continuar con tu cuenta. Este enlace no incluye el acceso a tu reserva. No se inició ningún cobro.';
  if (code === 'INVOICE_NOT_PAYABLE' || code === 'ORDER_NOT_ACTIVE') return 'Esta reserva ya no tiene un pago disponible. Consulta su estado en Storeganise.';
  if (code === 'STOREGANISE_RESERVATION_TOTAL_UNAVAILABLE') return 'El total de tu reserva todavía no está disponible. Regresa a Storeganise para completar los datos pendientes.';
  return 'No pudimos preparar el pago de tu reserva. Puedes intentarlo nuevamente o volver a Storeganise. No se inició ningún cobro.';
}

/** Compatibility entry for old GTM links. An order ID never authenticates its
 * owner. Signed handoffs go straight to the carousel with a single-use link.
 */
export default function ReservationAccess({ orderId, returnUrl }: { orderId: string; returnUrl: string }) {
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string>();
  const initial = useRef<Promise<{ url?: string; error?: string; status: number }> | null>(null);
  const inFlight = useRef(false);

  async function loadReservation() {
    const response = await fetch('/api/storeganise/reservation', {
      method: 'POST', credentials: 'same-origin', cache: 'no-store',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ orderId, returnUrl }),
      signal: AbortSignal.timeout(60_000),
    });
    return { ...await response.json(), status: response.status } as { url?: string; error?: string; status: number };
  }

  function accept(result: { url?: string; error?: string; status: number }) {
    if (result.status >= 400 || !result.url) {
      setError(result.error ?? 'STOREGANISE_RESERVATION_UNAVAILABLE'); setBusy(false); return;
    }
    const target = new URL(result.url);
    if (target.origin !== window.location.origin || target.pathname !== '/' || target.username || target.password ||
      target.hash || target.searchParams.getAll('session').length !== 1 || !/^[A-Za-z0-9_-]{43}$/.test(target.searchParams.get('session') ?? '')) {
      setError('STOREGANISE_RESERVATION_UNAVAILABLE'); setBusy(false); return;
    }
    try { window.sessionStorage.removeItem('pay-session-id'); } catch { /* The launch link identifies the reservation. */ }
    window.location.replace(target.href);
  }

  useEffect(() => {
    let active = true;
    initial.current ??= loadReservation();
    initial.current.then(result => { if (active) accept(result); }).catch(() => {
      if (active) { setBusy(false); setError('STOREGANISE_UNAVAILABLE'); }
    });
    return () => { active = false; };
    // The server keys this component by orderId; Strict Mode shares the request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function retry() {
    if (inFlight.current || busy) return;
    inFlight.current = true; setBusy(true); setError(undefined);
    try { accept(await loadReservation()); }
    catch { setError('STOREGANISE_UNAVAILABLE'); setBusy(false); }
    finally { inFlight.current = false; }
  }

  return <PayTransition busy={busy}
    title={busy ? 'Preparando tu pago' : 'Regresemos a tu reserva'}
    description={busy ? undefined : message(error ?? '')}>
    {!busy && <>
      {error !== 'STOREGANISE_CUSTOMER_LOGIN_REQUIRED' && <button type="button" onClick={retry} className="rounded-xl bg-[#164d40] px-5 py-3 text-sm font-semibold text-white focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#164d40]">Intentar nuevamente</button>}
      <a href={returnUrl} rel="noreferrer" className="rounded-xl border border-[#164d40]/25 px-5 py-3 text-sm font-semibold text-[#164d40] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#164d40]">Volver a mi reserva</a>
    </>}
  </PayTransition>;
}
