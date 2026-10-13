import PaymentCarousel from './components/payment-carousel';
import { sandboxManualEnabled } from '@/lib/pay/sandbox-manual';
import { redirect } from 'next/navigation';
import { legacyStoreganiseDestination, type StoreganiseSearchParams } from '@/lib/storeganise/browser-entry';

export const dynamic = 'force-dynamic';

export default async function PaymentPage({searchParams}:{searchParams:Promise<StoreganiseSearchParams>}) {
  let destination:string|undefined;
  try{
    destination=legacyStoreganiseDestination(await searchParams);
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
  if(destination)redirect(destination);
  return <PaymentCarousel manualSandboxEnabled={sandboxManualEnabled()} />;
}
