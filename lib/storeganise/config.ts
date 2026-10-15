import { gatewayEnvironment } from '../cybersource/environment';
import { storeganiseConfiguration } from './client';
import { isStoreganiseCustomerReturnUrl } from './customer-origins';

export class StoreganiseIntegrationError extends Error {
  constructor(readonly code: string, readonly httpStatus = 409) { super(code); this.name = 'StoreganiseIntegrationError'; }
}

export function assertStoreganiseEnabled() {
  if (process.env.STOREGANISE_PAY_ENABLED !== 'true') throw new StoreganiseIntegrationError('STOREGANISE_PAY_DISABLED', 503);
  const { url } = storeganiseConfiguration();
  const environment = gatewayEnvironment();
  const liveSandbox = environment === 'sandbox' && url.hostname.endsWith('.storeganise.com');
  if (liveSandbox && process.env.STOREGANISE_LIVE_SANDBOX_ENABLED !== 'true') {
    throw new StoreganiseIntegrationError('STOREGANISE_SANDBOX_INSTANCE_REQUIRED', 503);
  }
  if (environment === 'production' && !url.hostname.endsWith('.storeganise.com')) {
    throw new StoreganiseIntegrationError('STOREGANISE_INSTANCE_ENVIRONMENT_MISMATCH', 503);
  }
  return { url, environment, liveSandbox };
}

export function assertStoreganiseTestCustomer(customerId: string) {
  if (gatewayEnvironment() !== 'sandbox') return;
  const allowed = (process.env.STOREGANISE_TEST_CUSTOMER_IDS ?? '').split(',').map(value => value.trim());
  if (!allowed.includes(customerId)) {
    throw new StoreganiseIntegrationError('STOREGANISE_SANDBOX_CUSTOMER_NOT_ALLOWED', 403);
  }
}

export function validateEventOrigin(apiUrl: unknown) {
  if (apiUrl === undefined) return; // Standard account webhooks omit apiUrl.
  const { url } = storeganiseConfiguration();
  let candidate: URL;
  try { candidate = new URL(String(apiUrl)); } catch { throw new StoreganiseIntegrationError('INVALID_STOREGANISE_ORIGIN', 403); }
  if (candidate.origin !== url.origin || candidate.username || candidate.password ||
    !['/api', '/api/', '/api/v1/admin', '/api/v1/admin/'].includes(candidate.pathname) || candidate.search || candidate.hash) {
    throw new StoreganiseIntegrationError('INVALID_STOREGANISE_ORIGIN', 403);
  }
}

export function storeganiseReturnUrl(value?: string): string {
  const { url } = storeganiseConfiguration();
  const fallback = new URL('/', url.origin).href;
  if (!value) return fallback;
  let candidate: URL;
  try { candidate = new URL(value); } catch { return fallback; }
  if (!isStoreganiseCustomerReturnUrl(candidate, url.origin)) return fallback;
  return candidate.href;
}
