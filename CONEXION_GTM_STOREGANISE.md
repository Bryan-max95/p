# Storeganise → Pay sin segundo inicio de sesión

Actualización: 14 de octubre de 2026. Revisión por lectura de código. No se ejecutaron servidor, compilación, pruebas ni cobros. La integración desplegada no está validada.

## Registro: aviso Too many requests

El aviso reportado aparece al crear la cuenta, antes del pago. Storeganise documenta un máximo de **5 registros desde una misma IP en un período móvil de 24 horas**. No se reinicia a medianoche. La etiqueta de Pay no envía solicitudes de creación de clientes ni puede quitar ese límite del servidor. Para continuar el recorrido, usar una cuenta ya creada; para otro registro, esperar a que termine la ventana. Si ocurre sin haber realizado esos registros, pedir a Storeganise que revise el límite de la cuenta/red.

Fuentes oficiales: [Too many requests](https://help.storeganise.com/article/293-too-many-requests-alert) y [Troubleshooting logging in](https://help.storeganise.com/article/400-troubleshooting-logging-in?type=video).

Se leyó el contenedor público `GTM-N5GX4DLN`: estaba publicada la etiqueta V4, sin los identificadores de las versiones antiguas de redirección. Esto no equivale a inspeccionar todos los contenedores o scripts que pudiera cargar el navegador.

## Corrección de la etiqueta V5

V5 sale inmediatamente cuando la página no es una reserva en `step=billing`: no intercepta registro, inicio de sesión ni administración de métodos de pago del perfil. Solo inicia la conexión al pulsar el botón de pago de la reserva.

Usa el `siteId` del enlace nativo cuando está presente y es válido, ahorrando una consulta. Si falta, lo lee de la reserva. Esos identificadores solo seleccionan el contexto; el servidor sigue verificando la identidad autenticada y la propiedad de la reserva.

Mantiene una única apertura en curso, separa intentos por al menos ocho segundos y respeta `Retry-After` ante HTTP 429. Si el servidor no indica duración, pausa sus propias solicitudes durante un minuto; **no significa que el límite de Storeganise expire en ese tiempo**. No reintenta automáticamente ni recarga la página. Solo guarda la hora de la pausa en sessionStorage, sin datos de clientes ni tokens, y cancela la solicitud pendiente al salir de la página. Esto mejora la apertura del checkout; no corrige ni evita el límite nativo de registros.

Se conserva la corrección de diseño de V4: la política CSP de Storeganise exige un nonce específico para estilos. Se toma el valor de `#app[data-style-nonce]` de la página actual y se aplica al estilo antes de insertarlo. No usa el nonce de los scripts ni valores fijos. Se eliminaron los estilos en atributos HTML.

También conserva `orderId` en la solicitud nativa de checkout, además del retorno, y admite direcciones relativas de la página alojada de Storeganise. El destino final sigue siendo exclusivamente `https://www.payroatanselfstorage.com/?session=...`, con la sesión emitida por el servidor. No basta con llevar al cliente a la raíz de Pay sin una sesión autenticada.

Se reemplazó el error genérico por un código de soporte sin datos personales ni tokens. Esto permite distinguir el fallo de lectura de la reserva (`ORDER_HTTP_...`), el del checkout (`CHECKOUT_HTTP_...`), el de su página alojada (`HOSTED_HTTP_...`) y una respuesta sin enlace válido (`INVALID_CHECKOUT_RESPONSE`). No debe interpretarse automáticamente un 403, 404 o 409 como falta de integración: hay que revisar la respuesta de esa etapa.

Para usar V5, reemplazar **todo** el contenido de la etiqueta en Google Tag Manager con [el archivo completo](examples/gtm-storeganise-pago.html), publicar esa versión y recargar la página de Storeganise. Mantener una sola etiqueta de pagos. GitHub/Vercel no actualizan por sí solos Google Tag Manager.

Esta corrección se limita a la etiqueta y esta guía. No cambia la conexión de CyberSource, credenciales, configuración de entornos ni controles del servidor. No se confirmó aún una respuesta de checkout válida con la sesión de un cliente; por eso no se afirma que el recorrido completo ya funcione. Si falla, comunicar únicamente el código `V5 / ...` mostrado, sin enviar cookies, contraseñas ni enlaces con tokens.

## Qué incluye esta versión

- Se retiró de Pay el formulario de correo y contraseña.
- Se agregó una transición a pantalla completa con los logos actuales de Roatan Self Storage y BAC, con composiciones distintas para móvil y escritorio. No afirma que el pago esté aprobado mientras carga.
- Un enlace privado firmado por la integración abre directamente el carrusel con el cliente, la bodega y el importe obtenidos del servidor.
- El servidor admite una reserva autenticada sin factura interna previa para mostrar el importe: consulta la operación de vista previa de Storeganise. Para cobrar, Storeganise debe haber confirmado la reserva y preparado su registro contable.
- La identidad se verifica mediante la firma del evento y la propiedad de los registros en la API. Un orderId, correo o nombre recibido del navegador no autentica al cliente.

## Dependencia externa pendiente: no basta con desplegar

La integración de facturación personalizada de Storeganise debe estar configurada para emitir el handoff firmado y devolver al navegador el enlace de Pay. La configuración leída de la cuenta indica `billing: custom-billing`; eso no confirma que el checkout concreto esté devolviendo el enlace. La ruta nativa mostró 404 anteriormente, pero falta la respuesta autenticada actual para identificar la causa. Esta actualización no cambia la configuración de la cuenta Storeganise.

Además, su recorrido debe admitir un pago externo puntual y confirmar la reserva antes del cobro. El botón nativo de añadir tarjeta corresponde al registro de un método de pago; Pay no simula una tarjeta guardada. Si la orden permanece en notSubmitted o faltan firmas, la apertura del carrusel no confirma esa orden.

Está preparado un [mensaje concreto para Storeganise](SOLICITUD_STOREGANISE_ACCESO_DIRECTO.md). No se ha enviado.

## Publicar la etiqueta

1. Desplegar este commit en Vercel y conservar PAY_PUBLIC_URL=https://www.payroatanselfstorage.com.
2. Habilitar con Storeganise la integración y el recorrido anteriores. No publicar el reemplazo suponiendo que corrige por sí solo el 404.
3. Reemplazar completamente la etiqueta HTML anterior por [examples/gtm-storeganise-pago.html](examples/gtm-storeganise-pago.html). Mantener una sola etiqueta de pago, activada en All Pages, con disparo una vez por página. El script espera al paso de pago dentro de la navegación de Storeganise; no llama a la API por cargar la etiqueta.
4. Publicar en Google Tag Manager y recargar Storeganise. Subir archivos a GitHub no modifica una etiqueta ya publicada.

El script utiliza la sesión activa dentro del dominio Storeganise. Obtiene el siteId del enlace nativo o, si falta, lee la reserva. Solicita el checkout nativo con Accept: application/json y un returnUrl que conserva la reserva y los parámetros nativos de retorno. No muestra ese endpoint como página al cliente: obtiene el destino autenticado y navega a https://www.payroatanselfstorage.com/?session=...

Solo acepta ese dominio y un token de apertura de 43 caracteres. Si Storeganise devuelve un wrapper alojado en su propia ruta de facturación, puede leerlo una vez y extraer el enlace privado del HTML emitido por nuestro servidor. No ejecuta scripts de esa respuesta ni adivina un enlace si el proveedor devuelve otro contrato. No transmite claves, contraseñas, nombres, correos o importes en la URL.

Si el navegador llega con un enlace antiguo que contiene solo orderId/returnUrl, Pay no muestra datos privados. Una sesión de cliente previamente verificada aún puede abrir su reserva; de lo contrario ofrece volver a Storeganise, sin presentar otro formulario ni entrar a un cobro manual.

## Servidor y moneda

/api/storeganise/billing y /api/storeganise/checkout validan sg-signature antes de crear el enlace de apertura. Para una reserva sin factura, el servidor usa POST /api/v1/admin/jobs/{id}/operations/previewInvoice y lee su total. Esta operación se identificó por lectura del cliente público de administración de Storeganise; no se ha ejecutado ni se ha confirmado su permiso en esta cuenta.

El evento debe identificar al usuario y esa reserva. Pay verifica el propietario, el centro y el estado antes de obtener los datos. Una sesión por reserva/factura y los enlaces de un solo uso separan los clientes y evitan iniciar otro cobro por un reenvío del evento.

Los precios se muestran en USD y el cargo se prepara en HNL con BCH. Se mantiene la cotización durante la vigencia de la sesión y se vuelve a comprobar el saldo antes de autorizar la tarjeta.

El modo firmado no necesita una cookie con credenciales de Storeganise. No completa por la fuerza pasos de registro, firmas o confirmación: si la factura interna cobrable todavía no existe, devuelve STOREGANISE_RESERVATION_PENDING antes de la autorización. La factura fiscal del portal es independiente y sigue generándose después del pago.

No hay variables nuevas obligatorias en esta actualización. Se conservan la configuración de BCH, CyberSource, PostgreSQL, STOREGANISE_PAY_ENABLED, el secreto del webhook y el método card. Producción requiere Storeganise .com; sandbox bancario solo se conecta a la instancia Storeganise .dev. No se modificaron credenciales ni entornos.

## Pago y bodega

El procesamiento existente registra en Storeganise un pago externo con método card solamente después de confirmar el cobro en CyberSource. Comprueba la factura exacta, el importe y el saldo. Puede completar el paso configurado de factura inicial pagada.

Pay solo muestra la bodega activa cuando Storeganise devuelve occupied para el mismo cliente y alquiler. La confirmación, firmas y ocupación automática dependen del recorrido y las automatizaciones del centro; este commit no las habilita en Storeganise.

El portal fiscal sigue recibiendo los eventos de Storeganise por la conexión que administra el comercio. No se agregaron notificaciones directas desde Pay a ese portal.

## Referencias

[Checkout personalizado y requisito de Add-on](https://help.storeganise.com/article/471-accepting-payments-custom-booking-app).
[Confirmación, facturación y ocupación de bodegas](https://help.storeganise.com/article/159-jobs-move-ins).
