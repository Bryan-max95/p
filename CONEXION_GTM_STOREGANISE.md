# Conectar la etiqueta de Google Tag Manager con Pay

Actualización: 14 de octubre de 2026. Revisión del código y consultas de lectura; no se ejecutaron el proyecto, pruebas, compilación ni cobros. No se publicaron etiquetas ni se cambiaron ajustes remotos desde esta revisión.

## Corrección del mensaje junto al botón

Se comprobó que el contenedor público GTM-N5GX4DLN ya entrega la versión 2026-10-13.3. El archivo aportado por el comercio coincide con esa versión. El mensaje “No se pudo abrir el pago de su reserva” proviene de su función errorMessage: agrupa errores HTTP, de red, de formato y de preparación de sesión. El texto por sí solo no identifica cuál de ellos ocurrió.

Esa versión sustituye la navegación por fetch con redirect: "error", descarga el contenido y trata de extraer un enlace de Pay. Rechaza las redirecciones HTTP y depende de que la respuesta sea JSON o HTML con una forma específica. Eso añade restricciones que no tiene el enlace nativo del portal. No se capturó la respuesta HTTP del intento del comercio, por lo que no se afirma que haya sido una redirección el desencadenante concreto.

La nueva versión 2026-10-14.1 elimina esa petición y ese analizador. Utiliza el enlace /api/v1/billing/custom que Storeganise ya genera en su componente de facturación y navega con window.location.assign. El navegador conserva su sesión y sigue las respuestas y redirecciones normales. No sustituye botones basándose en su texto ni fabrica un endpoint si el botón no tiene un enlace nativo.

El componente público de la aplicación de clientes revisado genera un ancla hacia ese endpoint, con orderId, siteId y returnUrl. Esta corrección sigue ese comportamiento de la aplicación alojada; no sustituye la autenticación Bearer documentada para aplicaciones de reserva externas.

La etiqueta actúa solo en /sites/{sitio}/{tipo}?step=billing. Conserva el sitio y los parámetros de regreso, incluido _n, comprueba que los IDs de orden coincidan y permite un siteId vacío para una configuración de facturación global. No interviene en el registro, el perfil /account/billing ni la administración. Al volver con el botón Atrás se restablece la protección contra doble clic.

## Dónde colocar la etiqueta

1. Abrir Google Tag Manager, contenedor GTM-N5GX4DLN.
2. Ir a Etiquetas → payroatanselfstorage → HTML personalizado.
3. Sustituir el contenido completo por [examples/gtm-storeganise-pago.html](examples/gtm-storeganise-pago.html), incluidas las etiquetas script. Mantener una sola etiqueta de pago y el activador All Pages.
4. Guardar → Enviar → Publicar y crear versión. Recargar Storeganise completamente para retirar el listener anterior. No basta con guardar o subir el archivo a GitHub.

El marcador __BWP_PAY_TAG_VERSION__ de esta revisión vale 2026-10-14.1. Su guardia es __BWP_PAY_NATIVE_ACTIVE__. No incluye fetch, DOMParser ni el mensaje genérico citado arriba.

## Cómo se llega al dominio de Pay

La navegación pasa primero por Storeganise para que identifique a su cliente. El receptor firmado de Pay comprueba la relación cliente/orden/factura/bodega y crea la sesión. Su HTML contiene la redirección y un enlace de continuación a la URL privada del carrusel. El destino se configura en el servidor:

    PAY_PUBLIC_URL=https://www.payroatanselfstorage.com

El navegador termina en https://www.payroatanselfstorage.com/?session=… cuando el receptor emite correctamente la sesión. Poner directamente la portada de Pay en el botón no identifica al cliente ni establece su saldo. Esta etiqueta no transporta claves, tarjetas, precios o datos personales y no crea cobros.

Los enlaces antiguos que llegan a Pay con source=storeganise y una orden se remiten al checkout autenticado de Storeganise. Un enlace antiguo desde /account/billing sin orden ofrece volver a las reservas. No se crea una sesión a partir de IDs anónimos.

## Requisitos del receptor

- URL del webhook: https://www.payroatanselfstorage.com/api/storeganise/billing.
- STOREGANISE_API_KEY y el STOREGANISE_WEBHOOK_SECRET real de la cuenta deben estar en Vercel, entorno Production. Un cambio de variables requiere un nuevo despliegue.
- STOREGANISE_PAY_ENABLED=true habilita la integración. CyberSource sandbox requiere una instancia aislada .storeganise.dev; producción usa la instancia real .storeganise.com. Esta revisión no cambia esos entornos.
- El 401 de una entrega anterior indica un rechazo de autenticación del receptor. La nueva etiqueta no corrige un secreto incorrecto. Un GET de salud con 200 tampoco verifica la firma de un POST.

## Condición pendiente en las reservas sin factura interna

En la consulta de lectura del 14 de octubre se confirmó billing=custom-billing, billingTrigger=manual, moneda USD y un método externo card configurado. La lista de trabajos incluye una reserva reciente con orderState=notSubmitted, paso await_submitOrder y sin invoiceId. Esto demuestra que hay órdenes en el paso previo a la factura; no demuestra por sí solo que esa sea la petición que produjo el mensaje del navegador.

El checkout de Pay cobra una factura interna de Storeganise creada, emitida y con saldo. Cuando todavía no existe, responde ORDER_REQUIRES_CONFIRMED_INVOICE. El registro de un método de pago nativo puede ocurrir antes de confirmar la reserva. La etiqueta no cambia ese orden del proceso y no convierte un presupuesto en un saldo cobrable.

Para el flujo actual de cobro único, la reserva debe confirmarse y crear la factura antes de abrir el checkout. Se necesita una personalización compatible de Storeganise que envíe userId e invoiceId firmados a Pay en ese punto; ver [CONFIGURACION_STOREGANISE.md](CONFIGURACION_STOREGANISE.md). La otra arquitectura, guardar tarjetas en el paso nativo y cobrar después, exige tokenización reutilizable y un proveedor completo de billing.list / billing.charge, que este proyecto no implementa. No se devuelven tarjetas ficticias ni se confirma una orden sin la acción correspondiente del cliente.

La factura fiscal del portal es distinta: se emite después del pago mediante la integración Storeganise → portal que administra el comercio. Pay no llama directamente al portal ni exige una factura fiscal previa.

## Después del cobro

Pay muestra el importe de referencia en USD y cobra en HNL con la tasa BCH fijada para la sesión. Tras confirmar el cobro bancario, registra el pago externo por tarjeta contra la misma factura interna y conserva la referencia única de CyberSource. La bodega se muestra activa únicamente cuando Storeganise confirma su ocupación por ese cliente. Los webhooks de seguimiento despiertan la conciliación, pero no sustituyen la sesión de entrada al carrusel.

Referencias: [checkout de métodos de pago](https://help.storeganise.com/article/471-add-payment-methods-custom-booking-app), [gestión de entradas](https://help.storeganise.com/article/159-jobs-move-ins), [firmas de webhooks](https://help.storeganise.com/article/19-webhooks) y [publicación de Google Tag Manager](https://support.google.com/tagmanager/answer/6107163?hl=es).
