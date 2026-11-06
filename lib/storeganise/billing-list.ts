/** One-time card entry does not create a reusable stored payment method. */
export async function handleBillingList(payload: Record<string, unknown>) {
  const { userId, siteId } = z.object({ userId: sgId, siteId: z.union([sgId, z.literal('')]).optional() }).parse(payload.data);
  const { url, environment } = assertStoreganiseEnabled();
  assertStoreganiseTestCustomer(userId);
  if ((await getUser(userId)).isDisabled) throw new StoreganiseIntegrationError('CUSTOMER_DISABLED', 403);
  const result = await query<{ id: string; brand: string; last4: string; exp_month: number; exp_year: number; cardholder: string }>(
    `SELECT id,brand,last4,exp_month,exp_year,cardholder FROM pay_saved_methods
      WHERE customer_id=$1 AND api_origin=$2 AND environment=$3 AND ($4::text IS NULL OR site_id=$4)
      ORDER BY created_at DESC`, [userId, url.origin, environment, siteId || null]);
  return result.rows.map(method => ({ id: method.id, type: 'card', brand: method.brand, last4: method.last4,
    expMonth: method.exp_month, expYear: method.exp_year,
    card: { number: `************${method.last4}`, scheme: method.brand, name: method.cardholder,
      expiry: { month: String(method.exp_month).padStart(2, '0'), year: String(method.exp_year) } } }));
}

import { z } from 'zod';
import { query } from '../pay/db';
import { sgId, getUser } from './records';
import { assertStoreganiseEnabled, assertStoreganiseTestCustomer, StoreganiseIntegrationError } from './config';

