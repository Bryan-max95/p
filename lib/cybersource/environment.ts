export type GatewayEnvironment = 'sandbox' | 'production';

export function gatewayEnvironment(): GatewayEnvironment {
  const value = process.env.CYBERSOURCE_ENVIRONMENT?.trim() || 'production';
  if (value !== 'production') throw new Error('Invalid CYBERSOURCE_ENVIRONMENT');
  return value;
}

export function gatewayEndpoints(environment: GatewayEnvironment = gatewayEnvironment()) {
  if (environment !== 'production') throw new Error('Invalid gateway environment');
  return {
    api: 'https://api.cybersource.com', host: 'api.cybersource.com',
    flex: 'https://flex.cybersource.com', cardinal: 'https://centinelapi.cardinalcommerce.com',
  };
}
