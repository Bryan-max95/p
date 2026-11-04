# Precio en USD y cobro en lempiras con tasa de venta

Actualización: 4 de noviembre de 2026.

El precio original de Storeganise o del formulario manual se conserva en USD. Pay lo multiplica por la tasa de venta del BCH y envía el total convertido con `currency: HNL` a CyberSource en producción. El cliente ve el precio USD, el total HNL, la tasa de venta y su fecha antes de pagar. Storeganise recibe el saldo original USD y las notas del cobro HNL.

## Fuente oficial

Se consulta directamente el indicador **620 / EC-TCN-01-2**, descrito por el catálogo autenticado del BCH como **Tipo de Cambio Nominal - Venta**, de periodicidad diaria. No se calcula la venta sumando un porcentaje al tipo de compra ni se agrega un margen adicional.

- Catálogo: `GET https://bchapi-am.azure-api.net/api/v1/indicadores`.
- Cifras de venta: `GET https://bchapi-am.azure-api.net/api/v1/indicadores/620/cifras`.
- Documentación y suscripción: [portal oficial BCH](https://bchapi-am.developer.azure-api.net/).

Se verificaron ambos endpoints el 4 de noviembre de 2026 usando la suscripción existente. La serie de venta devolvió **L 27.0424 por USD 1** para esa fecha; la serie anterior 97 devolvió L 26.9079. Son datos de esa consulta, no valores fijos del código. Con aquella tasa de venta, USD 199.00 se convierten en **L 5381.44**.

## Configuración

```dotenv
BCH_API_KEY=
BCH_API_URL=https://bchapi-am.azure-api.net/api/v1/indicadores/620/cifras
BCH_INDICADOR_ID=620
```

La clave permanece privada en el servidor y se envía únicamente al host oficial mediante el encabezado `clave`. No usar `NEXT_PUBLIC_` ni incluirla en GTM.

Para mantener compatibles los despliegues anteriores, los valores conocidos de URL e indicador 97 se aceptan como configuración antigua y se normalizan a la serie 620. Nunca provocan una consulta o un respaldo a compra. Cualquier otro host, ruta o indicador se rechaza. Las variables locales y las de Vercel son independientes; este cambio de código no escribe las variables de Vercel.

## Cotizaciones y comprobantes

- La caché de venta usa `BCH-SELL-620` y valida `indicatorId=620`; no reutiliza la caché anterior `BCH-TCR-97`.
- La consulta se actualiza al necesitar una cotización si pasó una hora. Se usa el último dato aplicable según la fecha de Honduras, con antigüedad máxima de cuatro días calendario.
- Si falla la fuente de venta o llega una serie incorrecta, se bloquea la nueva cotización. No se usa una tasa de compra o manual como sustituto.
- La conversión utiliza aritmética decimal entera y redondea una sola vez a centavos de HNL.
- Cada sesión guarda el importe USD, la tasa, la fecha y el indicador. La columna aditiva `fx_indicator_id` se incorpora al inicializar la base. Las sesiones anteriores con fuente BCH e indicador vacío corresponden a compra/TCR 97.
- Las cotizaciones existentes, los pagos en proceso y los comprobantes conservan sus montos y su tasa. Un reintento del mismo evento reutiliza su cotización. Los enlaces de Storeganise que se renuevan por vencimiento o cambio de saldo guardan la nueva tasa de venta.
- El carrusel y el comprobante identifican compra o venta según la cotización guardada. Las notas nuevas enviadas a Storeganise identifican también la tasa usada.

## Verificación sin cobros

`pnpm pay:bch-check` solo consulta la tasa del BCH y calcula un ejemplo; no crea sesiones ni pagos. Las pruebas de `tests/pay-bch.test.ts` y `tests/pay-currency-session.test.ts` verifican la serie, la caché, la conversión, las etiquetas y la conservación de cotizaciones anteriores con proveedores simulados.

El cambio no altera el flujo de tarjeta, 3DS ni Tag Manager. La sincronización y activación de Storeganise conserva sus requisitos existentes; cambiar la tasa no completa por sí solo una reserva.
