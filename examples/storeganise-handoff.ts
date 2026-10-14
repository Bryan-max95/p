/**
 * Install in the authenticated Storeganise booking server/add-on, not in a browser.
 * Its caller must take authenticatedUserId from the verified login, and orderId
 * or invoiceId from that user's booking. Never trust an unsigned user ID.
 * This module is an integration example; it is not an open API route in Pay.
 */
import crypto from 'node:crypto';

export async function createPayRedirect(input: {
  authenticatedUserId: string;
  invoiceId?: string;
  orderId?: string;
  returnUrl?: string;
}): Promise<string> {
  if (typeof window !== 'undefined') throw new Error('Server-only integration');
  if ((!input.orderId && !input.invoiceId) || ![input.authenticatedUserId,
    ...(input.invoiceId === undefined ? [] : [input.invoiceId]),
    ...(input.orderId === undefined ? [] : [input.orderId])].every(value=>/^[a-f0-9]{24}$/i.test(value))) {
    throw new Error('An authenticated Storeganise user and specific order or invoice are required');
  }
  const secret=process.env.STOREGANISE_WEBHOOK_SECRET;
  const configured=process.env.PAY_PUBLIC_URL;
  if(!secret||/^(TU_|YOUR_|CHANGE_ME|<)/i.test(secret)||!configured)throw new Error('Missing handoff configuration');
  const origin=new URL(configured);
  if(origin.protocol!=='https:'||origin.username||origin.password)throw new Error('HTTPS Pay origin required');
  const body=JSON.stringify({type:'pay.checkout',id:crypto.randomUUID(),created:new Date().toISOString(),
    data:{userId:input.authenticatedUserId,invoiceId:input.invoiceId,orderId:input.orderId,
      ...(input.returnUrl?{returnUrl:input.returnUrl}:{})}});
  const signature=crypto.createHmac('sha256',secret).update(body).digest('base64');
  const response=await fetch(new URL('/api/storeganise/checkout',origin),{
    method:'POST',redirect:'error',cache:'no-store',signal:AbortSignal.timeout(60_000),
    headers:{'Content-Type':'application/json','sg-signature':signature},body,
  });
  if(!response.ok)throw new Error(`Pay could not create the checkout (${response.status})`);
  const result:unknown=await response.json();
  if(!result||typeof result!=='object'||!('url' in result)||typeof result.url!=='string')throw new Error('Invalid checkout response');
  const target=new URL(result.url);
  if(target.origin!==origin.origin||target.username||target.password||target.pathname!=='/'||
    !/^[A-Za-z0-9_-]{43}$/.test(target.searchParams.get('session')??''))throw new Error('Invalid checkout redirect');
  return target.href;
}
