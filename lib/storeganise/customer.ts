import crypto from 'node:crypto';
import { cookies } from 'next/headers';
import { z } from 'zod';
import { storeganiseConfiguration, StoreganiseApiError } from './client';
import { StoreganiseIntegrationError } from './config';

const cookieName = 'pay_storeganise_customer';
const purpose = 'pay/storeganise/customer/v1';
const identitySchema = z.object({ origin: z.string(), token: z.string().min(1).max(4096), expires: z.number() });

function encryptionKey() {
  const secret = process.env.PAY_SESSION_TOKEN_SECRET;
  if (!secret || secret.length < 32) throw new StoreganiseIntegrationError('STOREGANISE_SESSION_CONFIGURATION', 503);
  return Buffer.from(crypto.hkdfSync('sha256', secret, purpose, 'cookie encryption', 32));
}

/** Customer credentials only go to the configured Storeganise origin, never to a URL from GTM. */
async function customerRequest<T>(resource: string, authorization: string, method = 'GET', body?: unknown): Promise<T> {
  const { url } = storeganiseConfiguration();
  if (!/^\/(user(?:\?|$)|auth\/token$|units\/orders(?:\/|\?|$)|sites\/)/.test(resource) ||
    /[\s\\]/.test(resource) || resource.includes('..')) throw new StoreganiseIntegrationError('INVALID_RESOURCE', 400);
  let response: Response;
  try {
    response = await fetch(`${url.origin}/api/v1${resource}`, {
      method, redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(12_000),
      headers: { Authorization: authorization, Accept: 'application/json', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch { throw new StoreganiseApiError('NETWORK_ERROR'); }
  if (response.status === 401) throw new StoreganiseIntegrationError('STOREGANISE_CUSTOMER_LOGIN_REQUIRED', 401);
  if (!response.ok) throw new StoreganiseApiError('CUSTOMER_REQUEST_FAILED', response.status);
  try { return await response.json() as T; }
  catch { throw new StoreganiseApiError('INVALID_CUSTOMER_RESPONSE'); }
}

export function customerGet<T>(token: string, resource: string) {
  return customerRequest<T>(resource, `Bearer ${token}`);
}

export function customerPut<T>(token: string, resource: string, body: unknown) {
  return customerRequest<T>(resource, `Bearer ${token}`, 'PUT', body);
}

export async function signInCustomer(email: string, password: string) {
  // Do not log, persist, or return the password or Storeganise's access token.
  const response = await customerRequest<unknown>('/auth/token',
    `Basic ${Buffer.from(`${email}:${password}`, 'utf8').toString('base64')}`, 'POST');
  const { accessToken } = z.object({ accessToken: z.string().min(1).max(4096) }).parse(response);
  const { url } = storeganiseConfiguration();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv);
  cipher.setAAD(Buffer.from(purpose));
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify({ origin: url.origin, token: accessToken, expires: Date.now() + 30 * 60_000 }), 'utf8'), cipher.final()]);
  const value = Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString('base64url');
  if (value.length > 3800) throw new StoreganiseIntegrationError('STOREGANISE_SESSION_UNAVAILABLE', 503);
  (await cookies()).set(cookieName, value, { httpOnly: true, secure: true, sameSite: 'strict', path: '/', maxAge: 1800 });
}

export async function authenticatedCustomerToken(): Promise<string> {
  try {
    const value = (await cookies()).get(cookieName)?.value;
    if (!value || value.length > 3800) throw new Error('Missing session');
    const data = Buffer.from(value, 'base64url');
    const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(), data.subarray(0, 12));
    decipher.setAAD(Buffer.from(purpose));
    decipher.setAuthTag(data.subarray(12, 28));
    const payload = identitySchema.parse(JSON.parse(Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]).toString('utf8')));
    if (payload.expires <= Date.now() || payload.origin !== storeganiseConfiguration().url.origin) throw new Error('Expired session');
    return payload.token;
  } catch { throw new StoreganiseIntegrationError('STOREGANISE_CUSTOMER_LOGIN_REQUIRED', 401); }
}

export async function clearCustomerSession() {
  (await cookies()).delete(cookieName);
}
