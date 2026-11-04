interface Quote { amount?: string; hnlAmount?: string; hnlPerUsd: string; rateType?: 'sell' | 'buy' }

export function chargeLabel(amount: string, currency: string) {
  return `${currency === 'USD' ? '$ ' : currency === 'HNL' ? 'L ' : ''}${amount} ${currency}`;
}

export function chargeDisclosure(amount: string, currency: string, quote: Quote | undefined,
  language: 'es' | 'en', paid = false, simulated = false) {
  const label = chargeLabel(amount, currency);
  const main = language === 'es'
    ? `${simulated ? 'Importe de prueba:' : paid ? 'Cobro realizado:' : 'Se cobrará en su tarjeta:'} ${label}.`
    : `${simulated ? 'Test amount:' : paid ? 'Amount charged:' : 'Your card will be charged:'} ${label}.`;
  const equivalent = currency === 'USD' && quote?.hnlAmount
    ? (language === 'es' ? ` Equivalente informativo: L ${quote.hnlAmount} HNL.` : ` Reference equivalent: L ${quote.hnlAmount} HNL.`)
    : currency === 'HNL' && quote?.amount
      ? (language === 'es' ? ` Precio de referencia: $ ${quote.amount} USD.` : ` Reference price: $ ${quote.amount} USD.`) : '';
  const rateName = language === 'es'
    ? quote?.rateType === 'sell' ? 'Tipo de cambio de venta' : quote?.rateType === 'buy' ? 'Tipo de cambio de compra' : 'Tipo de cambio'
    : quote?.rateType === 'sell' ? 'Selling exchange rate' : quote?.rateType === 'buy' ? 'Buying exchange rate' : 'Exchange rate';
  const rate = quote ? (language === 'es'
    ? ` ${rateName}: L ${Number(quote.hnlPerUsd)} por USD 1.`
    : ` ${rateName}: L ${Number(quote.hnlPerUsd)} per USD 1.`) : '';
  return main + equivalent + rate;
}
