# Consultas técnicas pendientes para Storeganise

Este mensaje no se ha enviado. La nueva etiqueta V8 ya no usa `/api/v1/billing/custom`; estas consultas corresponden al canal privado y a la confirmación de reservas.

**Asunto: Validación de acceso privado y confirmación de reservas para Pay**

Hola, equipo de Storeganise:

Estamos integrando nuestros portales `booking.roatanselfstorage.com` y `roatanselfstorage.storeganise.com` con el checkout de pagos puntuales `https://www.payroatanselfstorage.com`. El cliente debe conservar su identificación sin volver a escribir su contraseña.

Necesitamos confirmar:

1. Que un campo de usuario `pay_checkout_bridge`, tipo `string` y `ownerAcl: "read"`, puede ser leído por el propio cliente autenticado mediante `GET /api/v1/user?include=customFields`, y no por otros clientes ni usuarios anónimos. Contendría un acceso limitado a cinco minutos, no claves administrativas ni datos de tarjeta. El cliente tampoco debe poder editarlo.
2. Que la clave administrativa puede actualizar parcialmente ese campo con `PUT /api/v1/admin/users/{id}`, preservando los demás. Entendemos que se pueden generar eventos de usuario; sus valores no deben aparecer en APIs públicas.
3. El permiso y contrato de `POST /api/v1/admin/jobs/{id}/operations/previewInvoice`, que usamos para mostrar el total de una reserva sin factura interna. Necesitamos confirmar que la operación no confirma el pedido ni inicia cobros.
4. Cómo configurar el recorrido nativo para confirmar la reserva, cumplir contratos y preparar su registro contable antes de un pago externo puntual. Pay no registra una tarjeta reutilizable ni debe saltarse estos requisitos. Sin confirmación, no autoriza el cargo.
5. Que las automatizaciones del centro habilitan la ocupación de la bodega por el cliente correcto después de registrar el pago externo con método `card`. El navegador no activa cuentas; Pay comprueba el estado en Storeganise.

Conservamos los webhooks firmados y la conexión de Storeganise con nuestro Portal fiscal. La reserva está en USD y el cargo bancario en HNL con BCH. La factura fiscal posterior al pago es distinta del registro contable interno.

No incluimos claves, cookies ni accesos temporales.

Saludos,
Roatan Self Storage
