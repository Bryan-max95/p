import type { GatewayEnvironment } from '../cybersource/environment';
import type { StoreganiseContext } from '../pay/types';

type PaymentBinding = { environment: GatewayEnvironment; storeganise_context?: StoreganiseContext | null };

function instance(origin: string | undefined): 'com' | 'dev' | undefined {
  if (!origin) return;
  try {
    const url = new URL(origin);
    if (url.protocol !== 'https:' || url.port || url.origin !== origin) return;
    return /^[a-z0-9-]+\.storeganise\.(com|dev)$/.exec(url.hostname)?.[1] as 'com' | 'dev' | undefined;
  } catch { return; }
}

export function isLiveStoreganiseSandbox(session: PaymentBinding): boolean {
  return session.environment === 'sandbox' && instance(session.storeganise_context?.apiOrigin) === 'com';
}

/** Derive this from the persisted payment, never from today's environment flag.
 * A later switch to production must not deliver an old sandbox payment to .com. */
export function storeganisePaymentWritesAllowed(session: PaymentBinding): boolean {
  const target = instance(session.storeganise_context?.apiOrigin);
  return (session.environment === 'production' && target === 'com') ||
    (session.environment === 'sandbox' && target === 'dev');
}
