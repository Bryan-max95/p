// Customer-facing aliases only. Admin API calls and their credentials always
// use STOREGANISE_API_URL; this list must never authorize an API destination.
const roatanApiOrigin = 'https://roatanselfstorage.storeganise.com';
const roatanBookingOrigin = 'https://booking.roatanselfstorage.com';

export function isStoreganiseCustomerOrigin(origin: string, apiOrigin: string): boolean {
  return origin === apiOrigin || (apiOrigin === roatanApiOrigin && origin === roatanBookingOrigin);
}

export function isStoreganiseCustomerReturnUrl(candidate: URL, apiOrigin: string): boolean {
  return isStoreganiseCustomerOrigin(candidate.origin, apiOrigin) &&
    !candidate.username && !candidate.password &&
    !/^\/(api|admin)(\/|$)/i.test(candidate.pathname);
}
