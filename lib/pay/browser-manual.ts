import crypto from 'node:crypto';
import { z } from 'zod';
import { gatewayEnvironment } from '../cybersource/environment';
import { query } from './db';
import type { CheckoutSessionInput, SessionRow } from './types';

/** The public form creates a standalone payment, never a Storeganise booking. */
export function manualPaymentEnabled() {
  try {
    const url = new URL(process.env.PAY_PUBLIC_URL ?? '');
    return gatewayEnvironment() === 'production' && process.env.PAY_MANUAL_ENABLED !== 'false' &&
      url.protocol === 'https:' && !url.username && !url.password &&
      !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  } catch { return false; }
}

export const browserManualSchema = z.object({
  reference: z.string().uuid(),
  clientName: z.string().trim().min(1).max(200),
  unitName: z.string().trim().max(60).default(''),
  amount: z.string().regex(/^\d{1,8}\.\d{2}$/).refine(value => Number(value) > 0),
}).strict();

export function browserManualInput(value: unknown): CheckoutSessionInput {
  if (!manualPaymentEnabled()) throw new Error('MANUAL_PAYMENTS_DISABLED');
  const details = browserManualSchema.parse(value);
  const identity = `manual-${details.reference}`;
  const names = details.clientName.split(/\s+/);
  return {
    eventId: `browser-manual-production-${details.reference}`, customerId: identity,
    orderId: details.reference, unitId: identity, clientName: details.clientName,
    unitName: details.unitName || 'Pago manual', concept: 'Pago manual',
    amount: details.amount, currency: 'USD', environment: 'production', source: 'manual',
    isTest: false, isDemo: false, fiscalEnvironment: 'production', payable: true,
    // Real billing details are collected and validated before starting 3DS.
    billTo: { firstName: names[0], lastName: names.slice(1).join(' '), email: '',
      address1: '', locality: '', country: '', postalCode: '' },
  };
}

/** Recover a lost preparation response without resetting a payment or extending its expiry. */
export async function openBrowserManualAccess(launchToken: string) {
  if (!manualPaymentEnabled() || !/^[A-Za-z0-9_-]{43}$/.test(launchToken)) throw new Error('MANUAL_PAYMENTS_DISABLED');
  const hash = (value: string) => crypto.createHash('sha256').update(value).digest('hex');
  const accessToken = crypto.createHmac('sha256', launchToken).update('pay-browser-manual-access-v1').digest('base64url');
  const result = await query<SessionRow>(`UPDATE pay_sessions SET access_hash=$2,
    consumed_at=COALESCE(consumed_at,now()),updated_at=now()
    WHERE launch_hash=$1 AND environment='production' AND checkout_source='manual'
      AND event_id LIKE 'browser-manual-production-%' AND storeganise_context IS NULL
      AND is_demo=false AND expires_at>now()
      AND (access_hash=$2 OR (access_hash IS NULL AND status='open')) RETURNING *`,
  [hash(launchToken), hash(accessToken)]);
  if (!result.rowCount) throw new Error('MANUAL_SESSION_NOT_RECOVERABLE');
  return { accessToken, session: result.rows[0] };
}
