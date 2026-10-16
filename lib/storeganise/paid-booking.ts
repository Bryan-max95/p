import { query, transaction } from '../pay/db';
import type { SessionRow } from '../pay/types';
import { StoreganiseIntegrationError } from './config';
import { storeganiseRequest } from './client';
import { assertOrderActive, getJob, getUnit, invoiceContext, usdAmount } from './records';
import { storeganisePaymentWritesAllowed } from './payment-policy';

type Job = Awaited<ReturnType<typeof getJob>>;
type Step = Job['steps'][number];
const confirmationSteps = new Set(['await_submitOrder', 'await_confirmOrder', 'order_confirm']);
const invoiceSteps = new Set(['invoice_createInitial', 'await_chargeInvoice', 'invoice_confirm']);
const occupancySteps = new Set(['await_confirmMovedIn', 'confirm_occupy']);

function assertPaid(session: SessionRow) {
  if (session.status !== 'succeeded' || !session.gateway_transaction_id || !session.paid_at || session.is_demo ||
    session.checkout_source !== 'storeganise' || !storeganisePaymentWritesAllowed(session)) {
    throw new StoreganiseIntegrationError('STOREGANISE_PAYMENT_NOT_CONFIRMED');
  }
}

function assertJob(session: SessionRow, job: Job) {
  const binding = session.storeganise_context!;
  if (job.id !== binding.jobId || job.ownerId !== session.customer_id || binding.customerId !== session.customer_id ||
    job.type !== 'unit_moveIn' || job.result.siteId !== binding.siteId ||
    (binding.selectedUnitId && job.result.unitId !== binding.selectedUnitId) ||
    (binding.unitTypeId && job.result.unitTypeId !== binding.unitTypeId) ||
    (binding.kind === 'invoice' && (job.result.invoiceId !== binding.invoiceId ||
      job.result.unitId !== binding.unitId || job.result.unitRentalId !== binding.rentalId))) {
    throw new StoreganiseIntegrationError('STOREGANISE_IDENTITY_MISMATCH', 403);
  }
  assertOrderActive(job);
  if (job.state === 'failed') throw new StoreganiseIntegrationError('MOVE_IN_REQUIRES_REVIEW');
}

/** The Management Portal uses PUT jobs/{id}/steps/{id} with state=completed.
 * Never uses skip, changes an owner, or fabricates an agreement/identity result.
 * Reserve each write durably: an ambiguous timeout must be read back, not replayed. */
async function completeStep(session: SessionRow, job: Job, step: Step) {
  assertPaid(session); assertJob(session, job);
  if (step.state !== 'ready' || job.steps.find(item => item.state === 'ready')?.id !== step.id) {
    throw new StoreganiseIntegrationError('STOREGANISE_STEP_CHANGED');
  }
  const claimed = await query(`INSERT INTO storeganise_step_operations(session_id,job_id,step_id,step_type)
    VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING RETURNING step_id`, [session.id,job.id,step.id,step.type]);
  if (!claimed.rowCount) throw new StoreganiseIntegrationError('STOREGANISE_STEP_WRITE_UNCONFIRMED');
  await storeganiseRequest(`/jobs/${job.id}/steps/${encodeURIComponent(step.id)}`, 'PUT', { state: 'completed' });
  await query(`UPDATE storeganise_step_operations SET status='acknowledged',updated_at=now()
    WHERE session_id=$1 AND job_id=$2 AND step_id=$3`, [session.id,job.id,step.id]);
}

/** Only runs after bank confirmation. The original sandbox checkout remains
 * read-only until then, so declines never confirm or occupy a real reservation. */
export async function bindPaidReservation(session: SessionRow): Promise<boolean> {
  assertPaid(session);
  const binding = session.storeganise_context!;
  if (binding.kind !== 'reservation') return true;
  if (!binding.jobId || session.order_id !== binding.jobId) throw new StoreganiseIntegrationError('STOREGANISE_IDENTITY_MISMATCH');
  let job = await getJob(binding.jobId);
  assertJob(session, job);
  if (!job.result.invoiceId) {
    const preview = await storeganiseRequest<{ total: number }>(`/jobs/${job.id}/operations/previewInvoice`, 'POST');
    if (usdAmount(preview.total) !== Number(session.reference_usd_amount).toFixed(2)) {
      throw new StoreganiseIntegrationError('INVOICE_CHANGED_AFTER_PAYMENT');
    }
    // Bound work per delivery. Subsequent reads/worker runs continue the same job.
    for (let i = 0; i < 3 && !job.result.invoiceId; i++) {
      const step = job.steps.find(item => item.state === 'ready');
      if (!step || !confirmationSteps.has(step.type)) return false;
      await completeStep(session, job, step);
      job = await getJob(job.id); assertJob(session, job);
    }
  }
  if (!job.result.invoiceId) return false;
  const context = await invoiceContext(job.result.invoiceId, session.customer_id, job.id);
  if (context.invoice.deleted || context.invoice.siteId !== binding.siteId ||
    (binding.selectedUnitId && context.unit.id !== binding.selectedUnitId) ||
    (context.invoice.currencyCode && context.invoice.currencyCode !== 'USD') ||
    (context.invoice.currency && context.invoice.currency !== 'USD') ||
    !['sent', 'overdue'].includes(context.invoice.state) ||
    usdAmount(context.invoice.balance) !== Number(session.reference_usd_amount).toFixed(2) ||
    context.rental.endDate || ['ended','archived','cancelled','canceled'].includes(context.rental.state) ||
    ['blocked','archived','unassigned'].includes(context.unit.state)) {
    throw new StoreganiseIntegrationError('INVOICE_CHANGED_AFTER_PAYMENT');
  }
  const nextBinding = { ...binding, kind: 'invoice' as const, invoiceId: context.invoice.id,
    rentalId: context.rental.id, unitId: context.unit.id };
  await transaction(async client => {
    // Serialize binding this paid reservation to its exact invoice.
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`pay-sg-paid:${binding.apiOrigin}:${context.invoice.id}`]);
    const saved = (await client.query<SessionRow>('SELECT * FROM pay_sessions WHERE id=$1 FOR UPDATE', [session.id])).rows[0];
    if (!saved || saved.status !== 'succeeded' || saved.gateway_transaction_id !== session.gateway_transaction_id ||
      saved.customer_id !== session.customer_id || saved.order_id !== session.order_id || saved.amount !== session.amount ||
      saved.storeganise_context?.sandboxActivation !== binding.sandboxActivation) {
      throw new StoreganiseIntegrationError('STOREGANISE_IDENTITY_MISMATCH');
    }
    const other = await client.query(`SELECT id FROM pay_sessions WHERE invoice_id=$1 AND id<>$2
      AND environment=$3 LIMIT 1`, [context.invoice.id,session.id,session.environment]);
    if (other.rowCount) throw new StoreganiseIntegrationError('STOREGANISE_INVOICE_ALREADY_LINKED');
    const updated = await client.query<SessionRow>(`UPDATE pay_sessions SET invoice_id=$2,unit_id=$3,unit_name=$4,
      storeganise_context=$5,updated_at=now() WHERE id=$1 RETURNING *`,
    [session.id,context.invoice.id,context.unit.id,context.unit.name,JSON.stringify(nextBinding)]);
    Object.assign(session, updated.rows[0]);
  });
  return true;
}

/** Payment, owner, rental and invoice are verified before completing occupancy.
 * No arbitrary steps are skipped. The API must confirm the resulting assignment. */
export async function completePaidMoveIn(session: SessionRow): Promise<boolean> {
  assertPaid(session);
  const binding = session.storeganise_context!;
  if (binding.jobId && process.env.STOREGANISE_COMPLETE_PAID_INVOICE_STEP === 'true') {
    for (let i = 0; i < 3; i++) {
      const context = await invoiceContext(binding.invoiceId!, session.customer_id, binding.jobId);
      if (!context.job || context.rental.id !== binding.rentalId || context.unit.id !== binding.unitId ||
        context.invoice.state !== 'paid' || Math.abs(context.invoice.balance) > 0.00001 || context.invoice.deleted ||
        context.rental.endDate || ['ended','archived','cancelled','canceled'].includes(context.rental.state) ||
        ['archived','blocked','unassigned'].includes(context.unit.state)) {
        throw new StoreganiseIntegrationError('STOREGANISE_PAID_MOVE_IN_MISMATCH');
      }
      assertJob(session, context.job);
      const step = context.job.steps.find(item => item.state === 'ready');
      if (!step) break;
      const stepInvoice = step.result?.invoiceId ?? context.job.result.invoiceId;
      if (invoiceSteps.has(step.type) && stepInvoice === binding.invoiceId) {
        await completeStep(session, context.job, step);
      } else if (occupancySteps.has(step.type)) {
        await completeStep(session, context.job, step);
      } else break;
    }
  }
  const unit = await getUnit(binding.unitId);
  return unit.state === 'occupied' && unit.ownerId === session.customer_id && unit.rentalId === binding.rentalId;
}
