# Pagos manuales y cobros en USD

Actualización del 2 de noviembre de 2026.

La entrada directa al dominio de Pay permite escribir nombre, referencia opcional y un monto positivo en USD. Continuar crea una sesión pendiente con ese monto y muestra los campos seguros de tarjeta y los datos reales de facturación. El cobro se solicita solo al pulsar pagar y completar la verificación bancaria requerida.

Los pagos nuevos, tanto manuales como de Storeganise, conservan `amount` y `currency=USD` durante 3DS, el envío a CyberSource y el comprobante. La tasa BCH queda fijada en la sesión para mostrar el equivalente informativo en HNL. Por ejemplo, USD 99.00 con una tasa de 26.50 muestra L 2,623.50 como referencia y solicita USD 99.00 al banco. La moneda enviada se especifica en `orderInformation.amountDetails.currency`, conforme a la [documentación de CyberSource](https://developer.cybersource.com/docs/cybs/en-us/payments/developer/gpn/rest/payments.html).

El script de Tag Manager no requiere cambios. Storeganise sigue determinando el propietario, la reserva y el saldo desde su API. Un pago manual independiente no asigna ni liquida una reserva automáticamente. La sincronización existente de Storeganise conserva sus comprobaciones; sus notas identifican el cobro en USD y el equivalente HNL.

## Configuración y despliegue

- `CYBERSOURCE_ENVIRONMENT=production`, credenciales de producción y `PAY_PUBLIC_URL` con el dominio HTTPS correcto.
- `PAY_MANUAL_ENABLED` queda habilitado por defecto; `false` deshabilita el formulario y su endpoint. La variable anterior `PAY_SANDBOX_MANUAL_ENABLED` no controla este flujo.
- Se siguen usando PostgreSQL, `PAY_SESSION_TOKEN_SECRET` y la configuración BCH existente.
- No se cambian las variables de Vercel mediante archivos locales. Los cambios requieren desplegarse para aparecer en el dominio publicado.

## Sesiones anteriores y validación

Los cobros históricos y los pagos en proceso conservan su moneda y comprobante originales. No se convierten pagos ya enviados. Los enlaces HNL sin pago iniciado deben abrirse nuevamente: Storeganise renueva las sesiones abiertas o rechazadas sin resultado incierto con el saldo verificado en USD. Los pagos manuales anteriores pueden iniciar una sesión nueva en USD. El servidor bloquea nuevos intentos de cobro con una sesión HNL.

Las pruebas usan proveedores y base de datos simulados. Verifican monto USD, equivalente BCH, facturación obligatoria, recuperación de una respuesta perdida, ausencia de pagos duplicados y conservación del vínculo de Storeganise. No acreditan que BAC haya habilitado USD para las credenciales del comercio: esa aceptación se observa en una operación iniciada por el operador. No se ejecutan cobros automáticos para validar este cambio.
