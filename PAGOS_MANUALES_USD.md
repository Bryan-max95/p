# Precios en USD y cobros en lempiras

Actualización del 4 de noviembre de 2026. Las nuevas cotizaciones usan la tasa de venta del BCH, indicador 620 (`EC-TCN-01-2`), sin agregar otro margen. La pantalla y el comprobante identifican el tipo de tasa aplicado; las cotizaciones existentes conservan la tasa que ya tenían guardada. Ver [fuente y configuración](CONFIGURACION_BCH.md).

La entrada directa al dominio de Pay permite escribir nombre, referencia opcional y un precio positivo en USD. Continuar crea una sesión pendiente con el monto convertido a HNL y muestra los campos seguros de tarjeta y los datos reales de facturación. El cobro se solicita solo al pulsar pagar y completar la verificación bancaria requerida.

Los pagos nuevos, tanto manuales como de Storeganise, guardan el precio original USD y la tasa BCH. El monto convertido (`amount`) y `currency=HNL` se conservan durante 3DS, el envío a CyberSource y el comprobante. Por ejemplo, USD 99.00 con una tasa de 26.50 solicita L 2,623.50 HNL al banco. La pantalla muestra el precio USD, la tasa y el total HNL antes de pagar. El servidor envía `orderInformation.amountDetails.currency=HNL` a `https://api.cybersource.com` y bloquea nuevas solicitudes financieras en USD.

El script de Tag Manager no requiere cambios. Storeganise sigue determinando el propietario, la reserva y el saldo desde su API. Un pago manual independiente no asigna ni liquida una reserva automáticamente. La sincronización existente registra el saldo original USD de la factura de Storeganise; sus notas identifican el cobro bancario en HNL, el precio USD y la tasa BCH.

## Configuración y despliegue

- `CYBERSOURCE_ENVIRONMENT=production`, credenciales de producción y `PAY_PUBLIC_URL` con el dominio HTTPS correcto.
- `PAY_MANUAL_ENABLED` queda habilitado por defecto; `false` deshabilita el formulario y su endpoint. La variable anterior `PAY_SANDBOX_MANUAL_ENABLED` no controla este flujo.
- Se siguen usando PostgreSQL, `PAY_SESSION_TOKEN_SECRET` y la configuración BCH existente.
- No se cambian las variables de Vercel mediante archivos locales. Los cambios requieren desplegarse para aparecer en el dominio publicado.

## Sesiones anteriores y validación

Los cobros históricos y los pagos en proceso conservan su moneda y comprobante originales. No se convierten pagos ya enviados. Los enlaces USD sin pago iniciado deben abrirse nuevamente: Storeganise renueva a HNL las sesiones abiertas o rechazadas sin resultado incierto, usando el saldo USD verificado. Un pago manual USD sin operación pendiente puede abrir un nuevo enlace con conversión a HNL. Los intentos con resultado incierto conservan el bloqueo y requieren conciliación; este cambio no los reintenta ni los declara pagados.

Las pruebas usan proveedores y base de datos simulados. Verifican conversión BCH, envío en HNL, rechazo de nuevos cobros USD, facturación obligatoria, recuperación de una respuesta perdida, ausencia de pagos duplicados y conservación del vínculo de Storeganise. No certifican la aceptación bancaria en producción. No se ejecutan cobros automáticos para validar este cambio.
