# Añadir tarjeta desde Billing

Actualización: 6 de noviembre de 2026.

## Qué se corrigió

El script V9 entregado por el comercio detenía el acceso de `/account/billing` con `PAYMENT_SITE_REQUIRED` cuando ni la página ni el enlace incluían `siteId`. Además, el backend solo reconocía las operaciones de reservas y no guardaba tarjetas reutilizables.

El script completo corregido es `examples/gtm-storeganise-pago-v9.html`. Sustituir la etiqueta anterior completa en Google Tag Manager, publicar una sola etiqueta de pagos y recargar el portal. Subir el backend a GitHub no actualiza Google Tag Manager.

## Flujo de cuenta

1. `prepare_payment_method` recibe `userId` y un `siteId` opcional. El servidor valida el cliente en Storeganise y los sitios reales de la cuenta. Si solo hay uno, resuelve el sitio sin exigirlo al navegador. La consulta de solo lectura realizada en esta sesión confirmó que la cuenta configurada tiene un sitio.
2. Si hay varios sitios y no llega un sitio válido, configurar `STOREGANISE_PAYMENT_METHOD_SITE_ID` en el servidor o enviar el sitio desde el enlace. No se elige el primer sitio arbitrariamente.
3. El servidor entrega un grant de cinco minutos al campo de perfil `pay_checkout_bridge`, legible por su dueño y no editable por el cliente. La respuesta pública solo contiene `{prepared:true}`.
4. GTM lee el perfil mediante la sesión nativa y envía `redeem_payment_method` con el grant. Se comprueban token, sitio, origen, entorno y uso único. Los grants de reserva y cuenta se preservan en el mismo campo.
5. Se abre `/?session=...&flow=payment_method`. El parámetro de presentación no autoriza operaciones: el registro utiliza una sesión independiente de servidor, una cookie HttpOnly y tablas propias. No acepta una sesión de reserva como sesión de tarjeta.
6. El carrusel reutiliza los campos alojados de CyberSource. El backend verifica el token firmado y sus datos enmascarados, vuelve a comprobar el cliente y sitio, y solicita una autorización de importe cero en HNL con `capture:false` y `TOKEN_CREATE` para `paymentInstrument`.
7. Solo después de una respuesta `AUTHORIZED` con una referencia de token válida se guardan su referencia privada, marca, últimos cuatro dígitos y vencimiento. Nunca se guardan PAN completo, CVV ni el token transitorio. Se muestra confirmación y se regresa a `/account/billing` en cinco segundos.
8. `billing.list` valida la firma existente y el cliente. Filtra por cliente, sitio, origen y entorno. Devuelve una lista vacía o referencias locales con metadatos enmascarados; no expone el token privado de CyberSource. Incluye los campos planos de la guía actual y el objeto `card` del contrato de Add-on.

Los intentos inciertos permanecen bloqueados para evitar reenvíos automáticos. El formulario consulta el estado al perder una respuesta. Si el banco confirma pero falla la escritura local, la sesión permanece en `registering` y requiere revisión usando `method-<sessionId>` en CyberSource; no se debe declarar la tarjeta guardada sin comprobarlo.

## Webhooks y reservas

`billing.checkout` sin reserva ni factura utiliza la misma creación de sesión de registro que el bridge. Requiere solicitud firmada, cliente válido y sitio resuelto. Conserva la respuesta HTML del Add-on. Con `orderId` o `invoiceId`, conserva los resolutores de pago existentes. `pay.checkout` sigue siendo de pago.

Esta integración utiliza el Add-on Pay de la cuenta configurada. Los métodos se separan por origen administrativo, entorno, cliente y sitio. No implementa múltiples bóvedas de proveedores distintos para un mismo sitio. La ausencia de filtro de sitio en la lista devuelve los métodos de Pay de ese cliente en la cuenta.

`prepare`, `redeem`, cargos HNL, 3DS, conciliación, registro en factura y activación conservan sus operaciones existentes. Las tablas de registro de tarjeta no contienen montos de reserva ni disparan sincronización de facturas. `billing.charge` conserva su respuesta de acción requerida; registrar una tarjeta no activa cobros recurrentes.

## Requisitos y verificación

- El comercio debe tener habilitados TMS y las autorizaciones de importe cero para su cuenta BAC/CyberSource. La aplicación no sustituye una verificación de cero por un cobro positivo. No se ha registrado una tarjeta real en esta sesión y no se certifica esa habilitación bancaria.
- Las tablas nuevas se crean de forma aditiva mediante el inicializador de esquema existente. No se modificaron variables privadas locales ni de Vercel.
- Las pruebas nuevas simulan banco y base de datos. Cubren registro, consulta, firma, aislamiento, caducidad, reintentos, prueba privada del bridge y los dos accesos GTM. La compilación de producción pasó.
- La batería completa anterior ya tenía 27 fallos; se ejecutó sobre el ZIP del commit original y se compararon sus nombres con los de la versión modificada. No aparecieron fallos adicionales. Muchos corresponden a expectativas de sandbox anteriores a la restricción de producción.
- El lint global encuentra errores anteriores en JavaScript privado descargado y `storeganise-return.tsx`. El lint de los archivos modificados pasó.
- Se probó el carrusel compilado en Edge con API y proveedor simulados: sesión, campos, formulario, guardado y confirmación. No llamó endpoints de pago de reservas. No es una certificación bancaria.

Después del despliegue y de publicar GTM, verificar en el navegador del comercio: agregar tarjeta desde Billing, confirmar que regresa y aparece en la lista; y pagar una reserva comprobando factura y activación. Estas verificaciones reales siguen pendientes; los tests simulados no las sustituyen.

## Respaldo

`respaldos/2026-11-06/pay-antes-metodos-pago-aeba8ca.zip` contiene los archivos versionados originales, sin `.env.local`. SHA256: `F8402A8E1FDC3C6B452928660DC78ABA71029DBCE5FDAED927665F03A9A10725`.

El script V9 original se conserva en `respaldos/2026-11-06/gtm-v9-original.html`. Los respaldos se entregan localmente y no se incluyen en el commit de implementación.

## Contratos consultados

- [Storeganise: registro y consulta de métodos](https://help.storeganise.com/article/471-add-payment-methods-custom-booking-app).
- [Storeganise: eventos de webhooks](https://help.storeganise.com/article/19-webhooks).
- [CyberSource: Microform y autorización de importe cero](https://developer.cybersource.com/docs/cybs/en-us/digital-accept-flex/developer/all/rest/digital-accept-flex.html).
