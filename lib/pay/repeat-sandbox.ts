import type { SessionRow } from './types';
import { transaction } from './db';
import { assertStoreganiseEnabled, StoreganiseIntegrationError } from '../storeganise/config';
import { isLiveStoreganiseSandbox } from '../storeganise/payment-policy';
import { verifyStoreganiseCheckout } from '../storeganise/checkout';

/** Explicit customer action, only for simulated payments with a live booking.
 * Keep every bank attempt and archive the completed receipt before clearing the
 * current form. This never creates a bank transaction or a Storeganise payment. */
export async function repeatSandboxPayment(authenticated: SessionRow, completedTransactionId: string) {
  const { url, liveSandbox } = assertStoreganiseEnabled();
  if (!liveSandbox || !isLiveStoreganiseSandbox(authenticated) || authenticated.is_demo ||
    authenticated.checkout_source !== 'storeganise' || authenticated.storeganise_context?.apiOrigin !== url.origin) {
    throw new StoreganiseIntegrationError('SANDBOX_REPEAT_DISABLED', 403);
  }
  // Recheck ownership, booking state and price using the same server-side flow.
  await verifyStoreganiseCheckout(authenticated);
  return transaction(async client => {
    const session = (await client.query<SessionRow>('SELECT * FROM pay_sessions WHERE id=$1 FOR UPDATE', [authenticated.id])).rows[0];
    if (!session || !isLiveStoreganiseSandbox(session) || session.is_demo || session.checkout_source !== 'storeganise' ||
      session.customer_id !== authenticated.customer_id || session.unit_id !== authenticated.unit_id ||
      session.order_id !== authenticated.order_id || session.invoice_id !== authenticated.invoice_id ||
      session.storeganise_context?.apiOrigin !== url.origin ||
      session.reference_usd_amount !== authenticated.reference_usd_amount || session.amount !== authenticated.amount) {
      throw new StoreganiseIntegrationError('STOREGANISE_IDENTITY_MISMATCH', 403);
    }
    if (session.gateway_transaction_id !== completedTransactionId) {
      // A double click or a lost response returns current state, never resets a
      // newer attempt/approval. The row lock serializes repeated requests.
      const prior = await client.query(`SELECT id FROM pay_audit_events
        WHERE event_type='sandbox_repeat' AND subject_id=$1 AND details->>'transactionId'=$2 LIMIT 1`,
      [session.id, completedTransactionId]);
      if (prior.rowCount) return session;
      throw new StoreganiseIntegrationError('SANDBOX_REPEAT_NOT_AVAILABLE');
    }
    if (session.status !== 'succeeded') throw new StoreganiseIntegrationError('SANDBOX_REPEAT_NOT_AVAILABLE');
    await client.query(`INSERT INTO pay_audit_events(event_type,subject_id,details) VALUES('sandbox_repeat',$1,$2::jsonb)`,
      [session.id, JSON.stringify({ environment: session.environment, transactionId: session.gateway_transaction_id,
        authorizationCode: session.authorization_code, gatewayStatus: session.gateway_status, paidAt: session.paid_at,
        customerId: session.customer_id, orderId: session.order_id, invoiceId: session.invoice_id, unitId: session.unit_id,
        amount: session.amount, currency: session.currency, referenceUsdAmount: session.reference_usd_amount,
        hnlPerUsd: session.usd_hnl_rate, rateDate: session.fx_rate_date, cardBrand: session.card_brand, cardLast4: session.card_last4 })]);
    return (await client.query<SessionRow>(`UPDATE pay_sessions SET status='open',capture_context=NULL,
      gateway_transaction_id=NULL,authorization_code=NULL,card_brand=NULL,card_last4=NULL,gateway_status=NULL,
      failure_reason=NULL,paid_at=NULL,storeganise_status='sandbox_only',portal_status='disabled',
      storeganise_payment_id=NULL,storeganise_error=NULL,expires_at=now()+interval '30 minutes',updated_at=now()
      WHERE id=$1 RETURNING *`, [session.id])).rows[0];
  });
}
