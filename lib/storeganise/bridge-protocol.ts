import crypto from 'node:crypto';
import { z } from 'zod';
import { StoreganiseIntegrationError } from './config';
import { sgId } from './records';

export const BRIDGE_FIELD = 'pay_checkout_bridge';
export const BRIDGE_TTL_SECONDS = 300;
export const BRIDGE_MAX_OPEN_ORDERS = 5;
const token = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
export const bridgeInput = z.discriminatedUnion('operation', [
  z.object({ operation: z.literal('prepare'), userId: sgId, orderId: sgId }).strict(),
  z.object({ operation: z.literal('redeem'), grantId: z.string().uuid(), token,
    clientNonce: token, orderId: sgId, returnUrl: z.string().url().max(2000) }).strict(),
]);

export const bridgeHash = (value: string) => crypto.createHash('sha256').update(value).digest('hex');

// The random grant ID and a server-only key derive a recoverable, scoped code.
// No account password, customer login token or API key is placed in the profile.
export function bridgeToken(id: string, origin: string, environment: string, secret: string): string {
  if (secret.length < 32) throw new StoreganiseIntegrationError('STOREGANISE_SESSION_CONFIGURATION', 503);
  return crypto.createHmac('sha256', secret)
    .update(JSON.stringify(['pay/profile-bridge/v1', id, origin, environment])).digest('base64url');
}

export function assertBridgeField(settings: unknown) {
  const schema = z.object({
    code: z.string(), type: z.string(), ownerAcl: z.string().optional(),
    required: z.boolean().optional(), secret: z.boolean().optional(), multiple: z.boolean().optional(),
    maxLength: z.number().nullish(), minLength: z.number().nullish(), enum: z.array(z.unknown()).nullish(),
  }).passthrough();
  // Other customer fields can use unrelated types/validation shapes.
  const collection = z.object({ userCustomFields: z.array(z.record(z.string(), z.unknown())) }).safeParse(settings);
  const matches = collection.success ? collection.data.userCustomFields.filter(item => item.code === BRIDGE_FIELD) : [];
  const parsed = matches.length === 1 ? schema.safeParse(matches[0]) : undefined;
  const field = parsed?.success ? parsed.data : undefined;
  if (!field || field.type !== 'string' || field.ownerAcl !== 'read' || field.required || field.secret || field.multiple ||
    (field.enum?.length ?? 0) > 0 || (field.minLength ?? 0) > 0 || (field.maxLength != null && field.maxLength < 4096)) {
    throw new StoreganiseIntegrationError('STOREGANISE_BRIDGE_FIELD_NOT_CONFIGURED', 503);
  }
}

export interface BridgeGrant {
  id: string; token_hash: string; customer_id: string; order_id: string;
  api_origin: string; environment: string; expires_at: Date;
  client_hash: string | null; lease_token: string | null; lease_until: Date | null;
  session_id: string | null;
}

export function assertBridgeProof(grant: BridgeGrant | undefined,
  input: { token: string; orderId: string; clientNonce: string },
  expected: { apiOrigin: string; environment: string }, now = Date.now()) {
  const presented = Buffer.from(bridgeHash(input.token), 'hex');
  const stored = Buffer.from(grant?.token_hash ?? '', 'hex');
  if (!grant || stored.length !== presented.length || !crypto.timingSafeEqual(stored, presented) ||
    grant.order_id !== input.orderId || grant.api_origin !== expected.apiOrigin || grant.environment !== expected.environment) {
    throw new StoreganiseIntegrationError('STOREGANISE_BRIDGE_ACCESS_INVALID', 403);
  }
  if (grant.expires_at.getTime() <= now) throw new StoreganiseIntegrationError('STOREGANISE_BRIDGE_ACCESS_EXPIRED', 410);
  if (grant.client_hash && grant.client_hash !== bridgeHash(input.clientNonce)) {
    throw new StoreganiseIntegrationError('STOREGANISE_BRIDGE_ACCESS_USED', 409);
  }
}
