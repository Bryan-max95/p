import { StoreganiseIntegrationError } from './config';
import type { getJob } from './records';

type Job = Awaited<ReturnType<typeof getJob>>;

// Only these existing workflow steps can be acknowledged by Pay after a
// confirmed charge. Agreements, identity checks and arbitrary steps stay with
// Storeganise and must never be marked as completed by this integration.
export const confirmationSteps = new Set(['await_submitOrder', 'await_confirmOrder', 'order_confirm']);
export const invoiceSteps = new Set(['invoice_createInitial', 'await_chargeInvoice', 'invoice_confirm']);
export const occupancySteps = new Set(['await_confirmMovedIn', 'confirm_occupy']);

export function assertReservationReadyToPay(job: Job) {
  const requiresCustomerAction = job.steps.some(step =>
    step.state === 'failed' || (step.requiresInput === true &&
      !['completed', 'skipped'].includes(step.state) &&
      !confirmationSteps.has(step.type) && !invoiceSteps.has(step.type) && !occupancySteps.has(step.type)));
  if (requiresCustomerAction) {
    throw new StoreganiseIntegrationError('STOREGANISE_RESERVATION_ACTION_REQUIRED', 409);
  }
}
