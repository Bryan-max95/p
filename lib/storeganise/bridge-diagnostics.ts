import { z } from 'zod';
import { ExchangeRateError } from '../pay/bch';
import { StoreganiseApiError } from './client';
import { StoreganiseIntegrationError } from './config';

export type BridgeStage = 'origin' | 'request' | 'rate-limit' | 'prepare' | 'redeem';
type Failure = { code: string; status: number; dependencyCode?: string; dependencyStatus?: number };

// Only fixed codes are logged. Never log error.message, SQL, request bodies,
// profile grants, API keys or customer details, even for unexpected exceptions.
const databaseCodes = new Set([
  '28000', '28P01', '3D000', '3F000', '42501', '42P01', '42703', '23505', '23503', '23502', '23514',
  '22P02', '22007', '40001', '40P01', '57014', '57P01', '53300', '08001', '08003', '08006',
  'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN',
  'CERT_HAS_EXPIRED', 'DEPTH_ZERO_SELF_SIGNED_CERT', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
]);
const knownErrors = new Map([
  ['DATABASE_URL is required', 'DATABASE_CONFIGURATION_MISSING'],
  ['PAY_PUBLIC_URL is required', 'PAY_PUBLIC_URL_INVALID'],
  ['PAY_PUBLIC_URL must use HTTPS', 'PAY_PUBLIC_URL_INVALID'],
  ['Invalid CYBERSOURCE_ENVIRONMENT', 'PAYMENT_ENVIRONMENT_INVALID'],
  ['Checkout event does not match its persisted session', 'CHECKOUT_SESSION_MISMATCH'],
  ['Checkout environment or source mismatch', 'CHECKOUT_CONFIGURATION_MISMATCH'],
  ['PAY_SESSION_TOKEN_SECRET must contain at least 32 characters', 'STOREGANISE_SESSION_CONFIGURATION'],
]);
const rateCodes = new Set([
  'BCH_SERVER_ONLY', 'BCH_NOT_CONFIGURED', 'BCH_INVALID_CONFIGURATION', 'BCH_INVALID_RESPONSE',
  'BCH_INVALID_RATE', 'BCH_CONFLICTING_RATES', 'BCH_RATE_OUTDATED', 'BCH_UNAVAILABLE', 'BCH_UNAUTHORIZED',
]);
const apiCodes = new Set([
  'SERVER_ONLY', 'CONFIGURATION_MISSING_OR_INVALID', 'INVALID_API_URL', 'INVALID_RESOURCE',
  'NETWORK_ERROR', 'REQUEST_FAILED', 'INVALID_RESPONSE',
]);

export function describeBridgeFailure(error: unknown, stage: BridgeStage): Failure {
  if (error instanceof StoreganiseIntegrationError) return { code: error.code, status: error.httpStatus };
  if (error instanceof ExchangeRateError) {
    return { code: rateCodes.has(error.code) ? error.code : 'BCH_UNAVAILABLE', status: 503 };
  }
  if (error instanceof StoreganiseApiError) {
    const detail = apiCodes.has(error.code) ? error.code : 'UNCLASSIFIED';
    return { code: error.status === 429 ? 'STOREGANISE_BRIDGE_RATE_LIMITED' :
      error.code === 'INVALID_RESPONSE' ? 'INVALID_STOREGANISE_DATA' :
        error.status ? `STOREGANISE_API_HTTP_${error.status}` : `STOREGANISE_API_${detail}`,
    status: error.status === 429 ? 429 : 503, dependencyCode: detail, dependencyStatus: error.status };
  }
  if (error instanceof z.ZodError || error instanceof SyntaxError) {
    return stage === 'request' ? { code: 'INVALID_BRIDGE_REQUEST', status: 400 } :
      { code: 'INVALID_STOREGANISE_DATA', status: 503 };
  }
  if (error instanceof Error && knownErrors.has(error.message)) {
    return { code: knownErrors.get(error.message)!, status: 503 };
  }
  const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined;
  if (typeof code === 'string' && databaseCodes.has(code)) {
    return { code: 'PAY_DATABASE_UNAVAILABLE', status: 503, dependencyCode: code };
  }
  return { code: 'STOREGANISE_BRIDGE_INTERNAL_ERROR', status: 503 };
}
