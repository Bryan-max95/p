import Image from 'next/image';
import { CreditCard, LockKeyhole } from 'lucide-react';
import type { ReactNode } from 'react';
import RoatanLogo from './roatan-logo';

export default function PayTransition({
  title = 'Preparando tu pago',
  description = 'Estamos cargando los datos de tu reserva y el total a pagar.',
  busy = true,
  children,
}: { title?: string; description?: string; busy?: boolean; children?: ReactNode }) {
  return <main className="pay-transition min-h-dvh bg-[#f8faf8] text-[#123d33] lg:grid lg:grid-cols-2">
    <section className="relative isolate flex h-[clamp(240px,38dvh,340px)] flex-col justify-between overflow-hidden bg-[#164d40] px-7 py-7 text-white sm:px-12 lg:h-auto lg:min-h-dvh lg:px-16 lg:py-12">
      <Image src="/pay-welcome-person.png" alt="" fill priority sizes="(min-width: 1024px) 50vw, 100vw" className="-z-20 object-cover object-[50%_18%] lg:object-[50%_30%]" />
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10 bg-gradient-to-t from-[#092b23]/95 via-[#092b23]/10 to-[#092b23]/15" />
      <div className="relative flex items-center justify-between gap-5">
        <div className="size-20 shrink-0 rounded-2xl bg-white p-1 shadow-lg sm:size-24 lg:size-32">
          <RoatanLogo className="size-full" />
        </div>
        <span className="text-right text-[10px] font-semibold uppercase tracking-[0.22em] text-white/75 lg:text-xs">Roatan Self Storage<br /><span className="mt-1 inline-block text-white/50">Portal de pagos</span></span>
      </div>
      <div className="relative mt-auto max-w-lg pt-8 lg:pt-72">
        <h2 className="text-3xl font-semibold leading-[1.1] tracking-tight lg:text-5xl xl:text-6xl">Tu espacio.<br />Tu siguiente paso.</h2>
        <p className="mt-5 hidden text-xs tracking-widest text-white/75 lg:block">ROATÁN · HONDURAS</p>
      </div>
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
