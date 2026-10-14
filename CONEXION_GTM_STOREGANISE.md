# Conectar la etiqueta de Google Tag Manager con Pay

Actualización: 13 de octubre de 2026. Código preparado sin ejecutar pruebas, compilación ni cobros. No se modificó Tag Manager, Vercel ni la configuración remota de Storeganise desde esta revisión.

## Estado comprobado y cambio a publicar

El archivo aportado por el comercio coincide con la etiqueta de la revisión anterior del repositorio. Sin embargo, la consulta de lectura al contenedor público GTM-N5GX4DLN seguía mostrando __BWP_PAYMENT_REDIRECT_ACTIVE__ y no __BWP_PAY_SESSION_ACTIVE__. Esto confirma que el código publicado por Google todavía era el redireccionador antiguo, aunque el nuevo pudiera estar guardado en el espacio de trabajo. Subir el archivo a GitHub no publica la etiqueta en Google.

Esta revisión corrige además el alcance de la etiqueta entregada anteriormente. Lleva el marcador __BWP_PAY_TAG_VERSION__ con valor 2026-10-13.3 y solo intercepta el pago en /sites/{sitio}/{tipo}?step=billing. Comprueba la ruta en cada clic para admitir la navegación de Storeganise sin recarga. No intercepta /account/billing, /admin ni el paso account del registro. Esto conserva esos controles nativos; no implementa por sí mismo un proveedor de tarjetas guardadas. Una petición pendiente tampoco redirige al cliente si ya salió de esa página.

La captura de Pay con source=storeganise y portalUrl terminado en /account/billing corresponde al enlace anterior del perfil, sin sesión ni reserva de cobro. Pay ahora distingue ese caso y ofrece volver a /account/units. No intenta deducir el importe, no solicita una tarjeta y no vuelve automáticamente al mismo botón del perfil.

## Qué cambia

La etiqueta anterior sustituía el enlace de Storeganise por la portada de Pay, con source, orderId, siteId y returnUrl. Esos parámetros no autentican al cliente. La etiqueta nueva contiene explícitamente PAYMENT_URL=https://www.payroatanselfstorage.com/ y abre ese dominio con una sesión emitida por el servidor.

Al pulsar el botón, primero hace una petición desde la página de Storeganise a su propio /api/v1/billing/custom, con la sesión del cliente que ya está abierta en ese mismo origen. Conserva orderId, siteId y returnUrl. El código de la aplicación de clientes revisado usa credenciales de navegador para sus propias peticiones; la etiqueta no extrae tokens de almacenamiento ni utiliza la API key administrativa.

Storeganise debe autenticar al cliente y ejecutar billing.checkout contra Pay. El receptor comprueba la firma, el propietario y el saldo por API; entonces devuelve el enlace privado del carrusel. La etiqueta solicita JSON al endpoint nativo, admite una respuesta JSON con url o el HTML del receptor de Pay, y solo navega si encuentra una sesión de Pay en el dominio exacto configurado. Si primero recibe una URL de checkout alojada en Storeganise, puede resolverla en ese mismo origen, con un máximo de tres peticiones y sin repetir URLs. No visita endpoints administrativos ni ejecuta scripts de esas respuestas.

La petición no cobra: únicamente prepara la sesión. No se aceptan precios o nombres del DOM ni del enlace. Si la autenticación, el webhook o la preparación fallan, se muestra un mensaje junto al botón y no se abre un formulario manual desvinculado de la reserva. Si la instancia devuelve otro contrato, una redirección HTTP o requiere autenticación distinta, será necesario adaptar la entrada conforme a esa respuesta; no se ha comprobado este recorrido en vivo.

La portada de Pay también reconoce los enlaces antiguos de GTM que contienen una orden y los remite al checkout de la instancia configurada, conservando la orden y el regreso. Los enlaces del perfil sin orden muestran la orientación indicada arriba. No consulta información privada ni crea pagos a partir de un orderId anónimo. Las sesiones válidas siguen abriendo directamente el carrusel.

El receptor firmado admite el orderId incluido en returnUrl, comprueba que coincida con cualquier orderId explícito y verifica propietario, bodega y sitio por API. Guarda el regreso correspondiente a la reserva. Después de comprobar pago aplicado y ocupación del cliente, el carrusel vuelve a Storeganise en cinco segundos; el cliente puede quedarse para guardar el comprobante.

## Dónde colocar la etiqueta

1. Desplegar primero esta revisión del código en Vercel.
2. Google Tag Manager → Etiquetas → payroatanselfstorage → HTML personalizado.
3. Sustituir el contenido completo por [examples/gtm-storeganise-pago.html](examples/gtm-storeganise-pago.html), incluyendo las etiquetas script. Conservar una sola etiqueta de pago y el activador existente All Pages. No añadirla junto a la anterior.
4. Guardar → Enviar → Publicar y crear versión. Guardar por sí solo no cambia la versión que reciben los clientes. Recargar completamente la página de Storeganise para retirar los listeners del script anterior.

No agregar claves de API o secretos a GTM. La etiqueta no obtiene importes del texto de la pantalla ni accede a tokens del navegador.

## Configuración del servidor

- PAY_PUBLIC_URL=https://www.payroatanselfstorage.com debe coincidir con el dominio de pago.
- PAYMENT_URL en la etiqueta debe tener el mismo origen exacto, incluyendo www. La etiqueta rechaza enlaces a dominios diferentes y enlaces sin session.
- El receptor sigue siendo https://www.payroatanselfstorage.com/api/storeganise/billing.
- STOREGANISE_API_KEY y STOREGANISE_WEBHOOK_SECRET deben estar en el servidor de Vercel. El secreto debe corresponder al usado para firmar el webhook.
- El 401 que se vio en webhook_call es un problema de autenticación del receptor, separado de la redirección del navegador. En Vercel → proyecto de Pay → Settings → Environment Variables, comprobar STOREGANISE_WEBHOOK_SECRET en Production y que sea el secreto de esta cuenta de Storeganise. Después de cambiarlo, hacer un nuevo despliegue de Production. No se verificó el valor desplegado ni una entrega firmada nueva en esta revisión. Un GET con 200 al receptor no verifica la firma de los POST.
- STOREGANISE_PAY_ENABLED controla la integración. Mantener entornos compatibles: sandbox con Storeganise dev; producción con la instancia real y el acceso BAC correspondiente. Esta revisión no cambió los entornos.

## Condición todavía pendiente para la reserva nativa

El comercio confirmó que la factura que se genera después de cobrar es la factura fiscal de su portal. Este código no crea esa factura ni llama directamente al portal: registra el pago confirmado en Storeganise, que conserva su propia conexión hacia el portal. No se exige que el portal emita una factura antes del cobro.

El checkout implementado cobra contra una factura interna de Storeganise ya creada y emitida. Ese registro proporciona el saldo autorizado; es distinto de la factura fiscal. El paso nativo de agregar tarjeta puede ocurrir cuando la orden aún no está enviada y todavía no tiene ese registro. En ese caso la respuesta es ORDER_REQUIRES_CONFIRMED_INVOICE; no se inventa un total ni se cobra un presupuesto.

Cambiar GTM no resuelve por sí solo esa diferencia. Para el flujo de cobro único hay que colocar el pago después de confirmar la orden y disponer de la factura, mediante una personalización compatible de Storeganise. La otra arquitectura, un proveedor nativo de tarjetas guardadas, exigiría implementar tokenización reutilizable y el contrato real de billing.list / billing.charge; el código actual no los proporciona ni devuelve tarjetas ficticias.

## Recorrido después de abrir el carrusel

El enlace session se intercambia por acceso a una única sesión de Pay vinculada al cliente, la bodega y la factura interna. El carrusel carga esos datos desde el servidor. Muestra la referencia en USD y mantiene el cobro HNL calculado con BCH, como en el procesamiento existente.

Tras confirmar el cobro bancario, Pay registra el pago externo por tarjeta en Storeganise usando los mismos IDs y la referencia única de CyberSource. La bodega solo se muestra activa cuando Storeganise confirma la ocupación del cliente correspondiente. La factura fiscal continúa a cargo del portal después de su notificación de pago. Los webhooks de seguimiento configurados siguen teniendo la misma función; no sustituyen la creación de la sesión del navegador.

## Hallazgo de la consulta de lectura

La orden indicada por el comercio (terminación f4032) inicialmente respondió con orderState=abandoned, sin invoiceId y con webhook_call fallido por un 401 del receptor de Pay. En la última consulta de lectura, job.state ya figuraba completed, sin paso actual pendiente, pero orderState seguía abandoned y seguía sin factura. La finalización del trabajo no convierte esa reserva en pagada ni demuestra que el secreto del webhook esté corregido. No se necesita reintentar otra vez ese trabajo terminado. El código comprueba el estado de la orden además del estado del trabajo y no permite cobrar órdenes abandonadas/canceladas.

Referencias: [checkout de métodos de pago](https://help.storeganise.com/article/471-add-payment-methods-custom-booking-app), [eventos y firmas](https://help.storeganise.com/article/19-webhooks) y [publicación de versiones de Google Tag Manager](https://support.google.com/tagmanager/answer/6107163?hl=es).
