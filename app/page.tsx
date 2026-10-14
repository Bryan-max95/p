import PaymentCarousel from './components/payment-carousel';
import { sandboxManualEnabled } from '@/lib/pay/sandbox-manual';
import { redirect } from 'next/navigation';
import { legacyStoreganiseEntry, type LegacyStoreganiseEntry, type StoreganiseSearchParams } from '@/lib/storeganise/browser-entry';

export const dynamic = 'force-dynamic';

export default async function PaymentPage({searchParams}:{searchParams:Promise<StoreganiseSearchParams>}) {
  let entry:LegacyStoreganiseEntry|undefined;
  try{
    entry=legacyStoreganiseEntry(await searchParams);
  }catch{
    // A failed Storeganise handoff must not become a manual, unrelated charge.
    return <main className="min-h-screen flex items-center justify-center bg-slate-50 px-6">
      <section className="max-w-md rounded-2xl border border-slate-200 bg-white p-6 space-y-3" role="alert">
        <h1 className="text-xl font-bold text-slate-900">No se pudo abrir el pago de su reserva</h1>
        <p className="text-sm text-slate-600">Regrese a su reserva en Storeganise para continuar. Si el problema persiste, contacte a Roatan Self Storage. No se inició ningún cobro.</p>
        <p className="text-sm text-slate-600" lang="en">Your booking payment could not be opened. Return to your Storeganise booking or contact Roatan Self Storage. No charge was started.</p>
      </section>
    </main>;
  }
  if(entry?.kind==='reservation-required')return <main className="min-h-screen flex items-center justify-center bg-slate-50 px-6">
    <section className="max-w-md rounded-2xl border border-slate-200 bg-white p-6 space-y-3">
      <h1 className="text-xl font-bold text-slate-900">Abra el pago desde su reserva</h1>
      <p className="text-sm text-slate-600">Este enlace proviene de los métodos de pago de su perfil y no tiene una reserva asociada. Regrese a sus reservas en Storeganise para continuar. No se inició ningún cobro.</p>
      <p className="text-sm text-slate-600" lang="en">This profile payment-method link does not include a booking. Return to your Storeganise bookings to continue. No charge was started.</p>
      <a href={entry.url} rel="noreferrer" className="inline-flex rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700">Volver a mis reservas / Return to my bookings</a>
    </section>
  </main>;
  if(entry?.kind==='checkout')redirect(entry.url);
  return <PaymentCarousel manualSandboxEnabled={sandboxManualEnabled()} />;
}
