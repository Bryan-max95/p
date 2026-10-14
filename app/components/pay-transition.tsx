import Image from 'next/image';
import { ArrowRight, CreditCard, LockKeyhole } from 'lucide-react';
import type { ReactNode } from 'react';
import RoatanLogo from './roatan-logo';

export default function PayTransition({
  title = 'Preparando tu pago',
  description = 'Estamos cargando los datos de tu reserva y el total a pagar.',
  busy = true,
  children,
}: { title?: string; description?: string; busy?: boolean; children?: ReactNode }) {
  return <main className="pay-transition min-h-dvh bg-[#f8faf8] text-[#123d33] lg:grid lg:grid-cols-2">
    <section className="relative flex flex-col justify-between overflow-hidden bg-[#164d40] px-7 py-7 text-white sm:px-12 lg:min-h-dvh lg:px-16 lg:py-12">
      <div aria-hidden="true" className="pointer-events-none absolute -right-40 -top-40 size-[32rem] rounded-full border border-white/10" />
      <div aria-hidden="true" className="pointer-events-none absolute -bottom-72 -left-40 size-[38rem] rounded-full border-[70px] border-white/[0.035]" />
      <div className="relative flex items-center justify-between gap-5">
        <div className="size-20 shrink-0 rounded-2xl bg-white p-1 shadow-lg sm:size-24 lg:size-32">
          <RoatanLogo className="size-full" />
        </div>
        <span className="text-right text-[10px] font-semibold uppercase tracking-[0.22em] text-white/75 lg:text-xs">Roatan Self Storage<br /><span className="mt-1 inline-block text-white/50">Portal de pagos</span></span>
      </div>
      <div className="relative hidden max-w-lg py-16 lg:block">
        <p className="mb-5 text-xs font-semibold uppercase tracking-[0.3em] text-[#f2cd66]">Tu próxima etapa</p>
        <h2 className="text-5xl font-semibold leading-[1.1] tracking-tight xl:text-6xl">Un espacio para<br />lo que más<br /><span className="text-[#f2cd66]">te importa.</span></h2>
        <p className="mt-7 max-w-sm text-base leading-7 text-white/70">Completa el pago de tu bodega y continúa con tu reserva en Roatan Self Storage.</p>
        <div aria-hidden="true" className="mt-12 flex items-center gap-3 text-white/40">
          <span className="h-px w-16 bg-white/25" /><ArrowRight className="size-5" /><span className="text-xs tracking-widest">ROATÁN · HONDURAS</span>
        </div>
      </div>
      <p className="relative mt-6 text-sm font-medium text-white/80 lg:hidden">Tu espacio, a un paso.</p>
      <p className="relative hidden text-xs text-white/50 lg:block">Roatan Self Storage · Pay</p>
    </section>

    <section className="flex flex-col items-center justify-center px-7 py-10 sm:px-12 sm:py-14 lg:px-16">
      <div className="w-full max-w-sm">
        <div className="mb-10 flex items-center gap-4 lg:mb-16">
          <div className="flex h-14 w-36 items-center justify-center rounded-xl border border-slate-200 bg-white px-4">
            <Image src="https://www.baccredomatic.com/themes/custom/bac_theme/images/logo.png" alt="BAC Credomatic" width={132} height={40} unoptimized priority className="max-h-9 w-auto max-w-full object-contain" />
          </div>
          <span className="text-xs leading-5 text-slate-500">Pagos con tarjeta<br /><span className="font-semibold text-slate-700">BAC · Honduras</span></span>
        </div>
        <div role={busy ? 'status' : 'alert'} aria-live="polite" aria-atomic="true">
          <div aria-hidden="true" className="relative mb-7 grid size-16 place-items-center rounded-2xl border border-[#164d40]/10 bg-white text-[#164d40]">
            <CreditCard className="size-7" strokeWidth={1.5} />
            {busy && <span className="absolute -bottom-1 -right-1 size-5 rounded-full border-[3px] border-[#e1ebe5] border-t-[#164d40] bg-[#f8faf8] motion-safe:animate-spin" />}
          </div>
          <h1 className="text-3xl font-semibold leading-tight tracking-tight sm:text-4xl">{title}</h1>
          <p className="mt-4 text-base leading-7 text-slate-600">{description}</p>
        </div>
        {busy && <div aria-hidden="true" className="mt-8 h-1 overflow-hidden rounded-full bg-[#dce7df]"><div className="pay-transition-progress h-full w-1/3 rounded-full bg-[#164d40]" /></div>}
        {children && <div className="mt-7 flex flex-wrap gap-3">{children}</div>}
        <div className="mt-10 flex items-start gap-2.5 border-t border-slate-200 pt-5 text-xs leading-5 text-slate-500 lg:mt-16">
          <LockKeyhole className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <p>Podrás revisar tu reserva y el total antes de confirmar el pago con tu tarjeta.</p>
        </div>
      </div>
    </section>
  </main>;
}
