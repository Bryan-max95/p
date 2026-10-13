# Conectar la etiqueta de Google Tag Manager con Pay

Actualización: 13 de octubre de 2026. Código preparado sin ejecutar pruebas, compilación ni cobros. No se modificó Tag Manager, Vercel ni la configuración remota de Storeganise desde esta revisión.

## Qué cambia

La etiqueta anterior sustituía el enlace de Storeganise por la portada de Pay, con source, orderId, siteId y returnUrl. Esos parámetros no autentican al cliente. El nuevo archivo conserva el enlace /api/v1/billing/custom: Storeganise identifica a su usuario, envía el webhook firmado y Pay devuelve el enlace con session.

La portada de Pay también reconoce los enlaces antiguos de GTM y los remite al checkout de la instancia configurada, conservando la orden y el regreso. No consulta información privada ni crea pagos a partir de un orderId anónimo. Las sesiones válidas siguen abriendo directamente el carrusel.

El receptor firmado admite el orderId incluido en returnUrl, comprueba que coincida con cualquier orderId explícito y verifica propietario, bodega y sitio por API. Guarda el regreso correspondiente a la reserva. Después de comprobar pago aplicado y ocupación del cliente, el carrusel vuelve a Storeganise en cinco segundos; el cliente puede quedarse para guardar el comprobante.

## Dónde colocar la etiqueta

1. Desplegar primero esta revisión del código en Vercel.
2. Google Tag Manager → Etiquetas → payroatanselfstorage → HTML personalizado.
3. Sustituir el contenido completo por [examples/gtm-storeganise-pago.html](examples/gtm-storeganise-pago.html). Conservar una sola etiqueta de pago y el activador existente.
4. Guardar y, cuando corresponda habilitar la conexión, publicar con Enviar. Recargar la página de Storeganise para retirar los listeners del script anterior.

No agregar claves de API o secretos a GTM. La etiqueta no obtiene importes del texto de la pantalla ni accede a tokens del navegador.

## Configuración del servidor

- PAY_PUBLIC_URL=https://www.payroatanselfstorage.com debe coincidir con el dominio de pago.
- El receptor sigue siendo https://www.payroatanselfstorage.com/api/storeganise/billing.
- STOREGANISE_API_KEY y STOREGANISE_WEBHOOK_SECRET deben estar en el servidor de Vercel. El secreto debe corresponder al usado para firmar el webhook.
- STOREGANISE_PAY_ENABLED controla la integración. Mantener entornos compatibles: sandbox con Storeganise dev; producción con la instancia real y el acceso BAC correspondiente. Esta revisión no cambió los entornos.

## Condición todavía pendiente para la reserva nativa

El checkout implementado cobra una factura interna ya creada y emitida. El paso nativo de agregar tarjeta puede ocurrir cuando la orden aún no está enviada y todavía no tiene factura. En ese caso la respuesta es ORDER_REQUIRES_CONFIRMED_INVOICE; no se inventa un total ni se cobra un presupuesto.

Cambiar GTM no resuelve por sí solo esa diferencia. Para el flujo de cobro único hay que colocar el pago después de confirmar la orden y disponer de la factura, mediante una personalización compatible de Storeganise. La otra arquitectura, un proveedor nativo de tarjetas guardadas, exigiría implementar tokenización reutilizable y el contrato real de billing.list / billing.charge; el código actual no los proporciona ni devuelve tarjetas ficticias.

## Hallazgo de la consulta de lectura

La orden indicada por el comercio (terminación f4032) respondió con orderState=abandoned y sin invoiceId. Su job.state seguía ready y había un paso webhook_call fallido; no se determinó qué receptor originó ese fallo. El código ahora comprueba el estado de la orden además del estado del trabajo, y bloquea órdenes abandonadas/canceladas. Ese enlace antiguo no sirve para acreditar un saldo pendiente ni para completar una entrada nueva.

Referencias: [checkout de métodos de pago](https://help.storeganise.com/article/471-add-payment-methods-custom-booking-app) y [eventos y firmas](https://help.storeganise.com/article/19-webhooks).
