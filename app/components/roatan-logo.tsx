import type { SVGProps } from 'react';

/** The same Roatan Self Storage mark used in the checkout header. */
export default function RoatanLogo(props: SVGProps<SVGSVGElement>) {
  return <svg viewBox="0 0 200 200" role="img" aria-label="Roatan Self Storage" {...props}>
    <g stroke="#111827" strokeWidth="6.5" strokeLinecap="round" strokeLinejoin="round" fill="none">
      <path d="M32,82 L100,20 L168,82" />
      <path d="M49,81 L49,94 M151,81 L151,94" />
      <path d="M59,82 L100,45 L141,82" />
      <circle cx="100" cy="63.5" r="19" fill="#f2b807" />
    </g>
    <path d="M100,55 A4.5,4.5 0 0,0 96.8,62 L95.2,71.5 C95.1,72.1 95.6,72.6 96.2,72.6 L103.8,72.6 C104.4,72.6 104.9,72.1 104.8,71.5 L103.2,62 A4.5,4.5 0 0,0 100,55 Z" fill="#111827" />
    <g textAnchor="middle" style={{ fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif', fontWeight: 900 }}>
      <text x="100" y="119" fill="#084c2e" fontSize="24" letterSpacing="0.5">ROATAN</text>
      <text x="100" y="151" fill="#084c2e" fontSize="19.5" letterSpacing="0.2">SELF STORAGE</text>
      <text x="100" y="173" fill="#111827" fontSize="14.5" letterSpacing="0.5">SAFE &amp; SECURE</text>
    </g>
    <path d="M48,128 H152" stroke="#111827" strokeWidth="4.5" strokeLinecap="round" />
  </svg>;
}
