import Image from 'next/image';

/** Official company artwork supplied by the owner; used inside the carousels. */
export default function CompanyLogo() {
  return <Image
    src="/roatan-self-storage-logo.png"
    alt="Roatan Self Storage — Safe & Secure"
    width={490}
    height={509}
    sizes="(min-width: 640px) 160px, 128px"
    priority
    className="mx-auto block h-auto w-32 object-contain sm:w-40"
  />;
}
