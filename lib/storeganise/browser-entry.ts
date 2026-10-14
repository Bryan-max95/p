import { z } from 'zod';
import { assertStoreganiseEnabled, StoreganiseIntegrationError } from './config';
import { storeganiseConfiguration } from './client';
import { sgId } from './records';

export type StoreganiseSearchParams = Record<string,string|string[]|undefined>;
export type LegacyStoreganiseEntry =
  | {kind:'checkout';url:string}
  | {kind:'reservation-required';url:string};

/** Only a navigation hint. It is never proof of the customer's identity. */
export function storeganiseBookingReturn(value:unknown):URL|undefined {
  if(value===undefined)return;
  if(typeof value!=='string'||value.length>2000)throw new StoreganiseIntegrationError('INVALID_STOREGANISE_RETURN_URL',400);
  let target:URL;
  try{target=new URL(value);}catch{throw new StoreganiseIntegrationError('INVALID_STOREGANISE_RETURN_URL',400);}
  const {url}=storeganiseConfiguration();
  if(target.origin!==url.origin||target.username||target.password||
    /^\/(api|admin)(\/|$)/i.test(target.pathname))throw new StoreganiseIntegrationError('INVALID_STOREGANISE_RETURN_URL',403);
  return target;
}

export function matchingOrderId(...values:unknown[]):string|undefined {
  const ids=values.filter(value=>value!==undefined&&value!==null&&value!=='').map(value=>sgId.parse(value));
  if(ids.some(id=>id!==ids[0]))throw new StoreganiseIntegrationError('STOREGANISE_IDENTITY_MISMATCH',403);
  return ids[0];
}

/** Recover the old GTM link via Storeganise's own authenticated checkout.
 * No customer data is fetched and no Pay session is issued from these URL IDs.
 * Storeganise must identify its logged-in customer and call the signed webhook.
 */
export function legacyStoreganiseEntry(params:StoreganiseSearchParams):LegacyStoreganiseEntry|undefined {
  if(params.source!=='storeganise')return;
  if(params.session!==undefined){
    if(typeof params.session==='string'&&/^[A-Za-z0-9_-]{43}$/.test(params.session))return;
    throw new StoreganiseIntegrationError('INVALID_TOKEN',400);
  }
  const input=z.object({orderId:sgId.optional(),siteId:sgId.optional(),
    returnUrl:z.string().optional(),portalUrl:z.string().optional()}).parse(params);
  const original=storeganiseBookingReturn(input.returnUrl);
  const portal=storeganiseBookingReturn(input.portalUrl);
  const orderId=matchingOrderId(input.orderId,original?.searchParams.get('orderId'),portal?.searchParams.get('orderId'));
  if(!orderId){
    // The old GTM tag also redirected the profile's Add payment method button.
    // It carries no payable reservation. Offer navigation, never an anonymous
    // checkout or a redirect back to the same billing button.
    const profile=[original,portal].find(target=>target&&/^\/account\/billing\/?$/.test(target.pathname));
    if(profile)return {kind:'reservation-required',url:new URL('/account/units',profile.origin).href};
    throw new StoreganiseIntegrationError('STOREGANISE_ORDER_REQUIRED',400);
  }
  const {url}=assertStoreganiseEnabled();
  const destination=new URL('/api/v1/billing/custom',url.origin);
  destination.searchParams.set('orderId',orderId);
  if(input.siteId)destination.searchParams.set('siteId',input.siteId);
  destination.searchParams.set('returnUrl',(original??portal??new URL('/',url.origin)).href);
  return {kind:'checkout',url:destination.href};
}
