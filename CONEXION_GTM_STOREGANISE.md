# Storeganise → Pay: etiqueta V8

Script completo: [examples/gtm-storeganise-pago.html](examples/gtm-storeganise-pago.html). Destino: **https://www.payroatanselfstorage.com/**, con una sesión privada creada por Pay. V8 no solicita `/api/v1/billing/custom` ni espera su enlace.

**Estado:** código implementado con validación automatizada local. Antes de activarlo para clientes hay que configurar y verificar el canal privado descrito abajo. No se ha comprobado el recorrido completo en la cuenta real ni realizado cobros. La conexión bancaria y sus credenciales no se modificaron.

## Diagnóstico

V7 mostraba `CHECKOUT_HTTP_404` cuando su petición autenticada a `/api/v1/billing/custom` recibía 404. El overlay detenía la navegación antes de llegar a Pay. Sin el cuerpo de aquella respuesta no se puede atribuir la causa interna a una configuración concreta de Storeganise. V8 evita esa dependencia.

El HTTP 429 al registrar clientes es independiente: esta etiqueta solo actúa al pulsar pago en una reserva con `step=billing`. No intercepta registro ni inicio de sesión, y no consulta APIs al cargarse.

## 1. Campo privado en Storeganise

En **Configuración → Campos personalizados → Usuarios**, crear:

| Opción | Valor |
| --- | --- |
| Código | `pay_checkout_bridge` |
| Título | `Acceso temporal a Pay` |
| Tipo | `String` / texto |
| Permisos del cliente | `View only` / Solo lectura; API: `ownerAcl: "read"` |
| Obligatorio | No |
| Secreto / múltiples valores | No |
| Opciones | Vacío |
| Longitud mínima | Vacío o 0 |
| Longitud máxima | Vacío o al menos 4096 |

La clave administrativa debe poder leer esa configuración y actualizar el campo del usuario. Pay valida la definición antes de emitir accesos. Storeganise documenta estos permisos, pero **no presenta este mecanismo como un SSO oficial**: es una integración propia basada en sus APIs y perfiles. [Campos personalizados](https://help.storeganise.com/article/114-custom-fields-settings).

El campo es visible en el perfil del cliente; no es invisible. Contiene JSON técnico con accesos limitados a cinco minutos. No incluirlo en correos, exportaciones públicas, analítica ni logs. Las actualizaciones pueden generar eventos de usuario para otras integraciones; no indican un pago. Si el Portal registra perfiles completos, debe excluir este campo de sus logs y documentos fiscales.

**Validación previa necesaria:** con cuentas controladas y sin cargos, comprobar que `GET /api/v1/user?include=customFields` entrega el valor exclusivamente al propietario autenticado. Un cliente distinto o una petición anónima no debe obtener ese perfil/campo, y el cliente no debe poder editarlo. Las APIs públicas no deben exponer valores de perfiles. Hasta comprobar ese aislamiento, conservar `STOREGANISE_BRIDGE_ENABLED=false`.

## 2. CSP en Storeganise

En **Configuración → Desarrollador → Content Security Policy / CSP**, añadir a `connect-src`:

```text
https://www.payroatanselfstorage.com
```

Conservar las entradas existentes, incluido `'self'`. Para las imágenes de la transición, añadir a `img-src` estos orígenes si no están permitidos:

```text
https://www.payroatanselfstorage.com
https://www.baccredomatic.com
```

Aplicar la política a ambos dominios de reservas. No quitar CSP ni usar `*`. [Configuración de CSP](https://help.storeganise.com/article/209-customise-your-content-security-policy).

## 3. Vercel y base de datos

En **Project → Settings → Environment Variables**, añadir en el entorno del despliegue:

```dotenv
STOREGANISE_BRIDGE_ENABLED=true
```

Habilitarla después de validar el aislamiento del campo. Mientras se configura, dejarla en `false`. Verificar también:

```dotenv
PAY_PUBLIC_URL=https://www.payroatanselfstorage.com
STOREGANISE_PAY_ENABLED=true
STOREGANISE_API_URL=https://roatanselfstorage.storeganise.com/api/v1/admin
STOREGANISE_CARD_PAYMENT_METHOD=card
```

Conservar los valores privados de `STOREGANISE_API_KEY`, `PAY_SESSION_TOKEN_SECRET` (mínimo 32 caracteres), `DATABASE_URL`, `STOREGANISE_WEBHOOK_SECRET`, BCH y CyberSource. Ninguna clave se pega en GTM. El método `card` debe existir en los métodos de pago manuales de Storeganise.

La tabla nueva `pay_storeganise_bridge_grants` se crea mediante el esquema aditivo existente en la primera operación de base de datos. La conexión debe permitir esa migración y usar la base persistente de Pay. No se ejecutó una migración contra la base real durante este cambio.

**Actualización del 16 de octubre: activación real tras aprobación sandbox.** Añadir `STOREGANISE_SANDBOX_ACTIVATION_ENABLED=true` y conservar `STOREGANISE_COMPLETE_PAID_INVOICE_STEP=true`. Redesplegar y crear una reserva nueva. El permiso se guarda por sesión y no aplica pruebas históricas. Ver [la configuración completa y el proceso de activación](ACTIVACION_STOREGANISE.md).

**Modo aislado anterior: Storeganise real y CyberSource sandbox sin activar bodegas.** Con `STOREGANISE_SANDBOX_ACTIVATION_ENABLED=false` o ausente, usar:

```dotenv
CYBERSOURCE_ENVIRONMENT=sandbox
STOREGANISE_LIVE_SANDBOX_ENABLED=true
PAY_DEMO_ENABLED=false
PAY_SANDBOX_MANUAL_ENABLED=false
```

Todos los clientes autenticados de la instancia real pueden acceder con su propia reserva, sin añadir IDs a `STOREGANISE_TEST_CUSTOMER_IDS`. Esa variable solo aplica a la instancia aislada `.dev` y a los formularios manuales/de demostración. La comprobación de identidad y propiedad de la reserva sigue siendo obligatoria. Las claves CyberSource configuradas deben tener acceso al entorno sandbox; una respuesta 401 requiere revisar esas credenciales.

`Production and Preview` es el ámbito de Vercel, no el entorno bancario. El código selecciona `apitest.cybersource.com`, Flex y 3DS sandbox cuando `CYBERSOURCE_ENVIRONMENT=sandbox`, aunque Vercel sea un despliegue Production. Mantener `STOREGANISE_API_URL=https://roatanselfstorage.storeganise.com/api/v1/admin` y las claves actuales de Storeganise. No se necesita cambiar el script GTM, los webhooks ni el campo `pay_checkout_bridge` que ya funcionan.

Esta modalidad conserva la autenticación del cliente, el monto USD y la conversión BCH a HNL. La tarjeta se escribe manualmente en Microform. Antes del pago se vuelve a comprobar el propietario, la reserva y su total. Si aún no hay factura interna, se consulta el cálculo de Storeganise sin enviar la reserva ni crear su factura. La única escritura necesaria para el acceso sigue siendo el campo temporal privado del bridge.

Una aprobación sandbox se guarda en Pay como prueba: no se publica en el libro de pagos real de Storeganise, no completa pasos de ocupación, no activa bodegas y no dispara desde Pay una notificación de pago al portal fiscal. Esto se aplica también a reintentos/reconciliación y a sesiones sandbox antiguas después de volver a producción. El carrusel muestra el resultado de prueba sin esperar activación ni redirigir automáticamente como si la bodega estuviera habilitada.

Después de una aprobación aparece **Repetir prueba con otra tarjeta**. Esa acción vuelve a comprobar la reserva y su total, archiva el comprobante anterior y abre de nuevo el formulario. Conserva todos los intentos y no realiza un cobro por sí misma. Puede repetirse sin un límite total de pruebas; los controles de concurrencia y frecuencia siguen vigentes. No reinicia intentos pendientes, inciertos ni pagos de producción.

El error `STOREGANISE_SANDBOX_INSTANCE_REQUIRED` significa que falta habilitar `STOREGANISE_LIVE_SANDBOX_ENABLED=true` para esta combinación. `STOREGANISE_SANDBOX_CUSTOMER_NOT_ALLOWED` solo corresponde a la lista de la instancia aislada `.dev`; si aparece en este flujo real, verificar que Vercel ejecuta la última versión. Para pagos reales posteriores, usar `CYBERSOURCE_ENVIRONMENT=production`, desactivar `STOREGANISE_LIVE_SANDBOX_ENABLED` y configurar credenciales con acceso a producción. Las pruebas no se convierten en pagos reales; abrir una sesión nueva desde Storeganise después de cada cambio de entorno. Actualizar `.env.local` o GitHub no modifica las variables de Vercel.

Redesplegar tras cambiar variables. Confirmar que el dominio de Pay apunta a ese despliegue y que su protección de Vercel no exige un login adicional para `/api/storeganise/bridge`. Conservar el webhook y la reconciliación existentes.

## 4. Publicar la etiqueta

1. Desplegar el servidor y completar la configuración anterior.
2. En GTM, abrir la etiqueta de pagos **HTML personalizado**.
3. Sustituir **todo** su contenido por [el script completo](examples/gtm-storeganise-pago.html), incluyendo `<script>` y `</script>`.
4. Mantener una sola etiqueta de pago, activada en **All Pages**, una vez por página. Desactivar versiones anteriores.
5. Publicar el contenedor y recargar Storeganise. GitHub/Vercel no publican GTM automáticamente.

V8 funciona en `https://booking.roatanselfstorage.com` y `https://roatanselfstorage.storeganise.com`. Conserva el dominio de la sesión en las lecturas y el retorno. No intercepta el botón de añadir tarjeta del perfil: cobra una reserva, no registra tarjetas reutilizables.

## Comunicación e identificación

Todas las conexiones son HTTPS. La cookie de Storeganise permanece en su propio dominio.

1. Al pulsar pago, GTM lee `/api/v1/user?include=customFields` con la sesión activa. Obtiene el ID del usuario y el `orderId` de la página.
2. Envía `POST https://www.payroatanselfstorage.com/api/storeganise/bridge` con `{ operation: "prepare", userId, orderId }`. Esos IDs son referencias, **no prueba de identidad**. Pay consulta el propietario y estado reales de la reserva.
3. Pay guarda el hash de un acceso temporal en PostgreSQL y entrega su valor únicamente en el campo de ese perfil mediante una actualización parcial. La respuesta pública es solo `{ "prepared": true }`, sin acceso, precio, datos personales ni enlace.
4. GTM vuelve a leer el propio perfil autenticado y comprueba que sigue siendo el mismo usuario. Obtiene el acceso de esa reserva. Son dos lecturas, sin sondeo ni reintentos automáticos.
5. Envía `operation: "redeem"` al mismo endpoint con el acceso, la reserva, un identificador aleatorio del intento y el retorno. Pay verifica hash, caducidad y vinculación. Después de la primera reclamación rechaza otro identificador de intento.
6. Pay vuelve a comprobar propietario/centro/bodega, consulta el importe y crea o recupera la sesión del carrusel existente. GTM navega a `https://www.payroatanselfstorage.com/?session=...` usando un enlace de apertura de un solo uso.

CORS restringe páginas de origen, pero **no autentica al cliente**. La prueba es el acceso obtenido del perfil privado. No se transmiten claves administrativas, contraseñas ni cookies a Pay, ni precios/nombres/correos en la URL. GTM solo guarda una hora de pausa en `sessionStorage`.

Los registros y bloqueos de PostgreSQL separan reservas y serializan entregas por cliente. Límites: cinco reservas pendientes por perfil, doce accesos nuevos por diez minutos por cliente y veinte peticiones por minuto por IP. Un valor vencido puede permanecer en el perfil, pero el servidor ya no lo acepta; una entrega posterior elimina los valores obsoletos del contenido entregado.

## Importe, pago y bodega

Con factura interna, Pay consulta el saldo exacto y su propietario. Sin factura, usa `POST /api/v1/admin/jobs/{id}/operations/previewInvoice` para mostrar el total de la reserva. Esa operación se identificó en el cliente administrativo de Storeganise; **su permiso y respuesta en esta cuenta requieren validación real**. Las pruebas locales usan una respuesta simulada.

El precio se muestra en USD y el cargo se calcula en HNL mediante BCH. Se reutilizan el carrusel, tokenización, 3DS y procesamiento bancario existentes. Si faltan datos obligatorios de dirección en Storeganise, el carrusel conserva su captura; no se inventan ni se solicita la contraseña.

En producción bancaria, Pay vuelve a consultar la reserva y exige su registro contable interno confirmado antes de cobrar. Con sandbox y activación explícita, revalida el total antes del pago y completa la confirmación de la reserva después de aprobar, vinculando su factura interna antes de registrar el pago. La factura fiscal del Portal es diferente y sigue siendo posterior al pago.

La API debe aceptar las operaciones de confirmación y ocupación con las credenciales configuradas. El servidor ejecuta los pasos conocidos; la etiqueta GTM mantiene su función de identificación y redirección. El recorrido desplegado debe verificarse con una prueba manual.

Después de un cobro confirmado, el proceso existente **servidor Pay → Storeganise** registra el pago en la factura del cliente correcto, con método `card`. El script no activa cuentas. Pay solo muestra la bodega activa cuando Storeganise confirma su ocupación por ese cliente. Storeganise mantiene su conexión con el Portal fiscal; no se añadió comunicación directa Pay → Portal.

## Diagnóstico V8

| Código | Qué revisar |
| --- | --- |
| `BRIDGE_HTTP_404` | Ruta nueva ausente del despliegue o dominio apuntando a una versión anterior. |
| `BRIDGE_NETWORK` | CSP `connect-src`, CORS, conexión o protección de despliegue. |
| `STOREGANISE_BRIDGE_DISABLED` | Variable ausente/en false o falta redesplegar. |
| `STOREGANISE_BRIDGE_FIELD_NOT_CONFIGURED` | Definición y permisos exactos del campo. |
| `STOREGANISE_BRIDGE_PROFILE_UNAVAILABLE` | El perfil no devolvió acceso para esa reserva. |
| `USER_HTTP_401` | Sesión de Storeganise vencida. |
| `STOREGANISE_API_HTTP_401` / `403` | Credencial/permisos de API administrativa, no tarjeta. |
| `STOREGANISE_API_HTTP_404` | Recurso/operación de API; revisar registro sin suponer su causa. |
| `STOREGANISE_BRIDGE_ACCESS_EXPIRED` / `USED` | Volver a la reserva y abrir un nuevo acceso. |
| `STOREGANISE_IDENTITY_MISMATCH` / `ACCESS_INVALID` | Usuario, reserva o acceso no corresponden. |
| `STOREGANISE_SANDBOX_INSTANCE_REQUIRED` | Banco sandbox con cuenta `.com` sin `STOREGANISE_LIVE_SANDBOX_ENABLED=true`. |
| `STOREGANISE_SANDBOX_CUSTOMER_NOT_ALLOWED` | Falta el ID en la lista de la instancia aislada `.dev`. Storeganise real con sandbox habilitado no requiere esa lista. |
| `STOREGANISE_RESERVATION_PENDING` | Falta registro interno confirmado; no se autoriza el cargo. |
| `USER_HTTP_429` / `BRIDGE_HTTP_429` | Respetar Retry-After; no hay reintentos automáticos. |

Compartir solo código, etapa y estado HTTP. No enviar valores del campo, cookies ni enlaces con `session`.

## Validación y límites

Resultado local de esta entrega: **69 tests aprobados**, TypeScript sin errores, ESLint aprobado en los archivos revisados y compilación de producción completada. La compilación mostró avisos de caché de Webpack sin impedir el resultado. Tras ajustar el código de diagnóstico, se repitieron los 17 tests de la integración y pasaron.

Los tests locales cubren propietario, caducidad/reutilización, saldo en servidor, reserva sin factura, bloqueo del cobro pendiente, CORS, ambos dominios, errores HTTP, doble clic, registro intacto y ausencia de llamadas a `/billing/custom`. Proveedores y PostgreSQL están simulados. Se ejecutan también los tests existentes de moneda y pagos para detectar regresiones.

TypeScript y la compilación verifican código, no el contrato real de Storeganise. Quedan pendientes: lectura privada del campo con sesiones reales, permiso de vista previa, CSP desplegada, sincronización y ocupación tras un pago autorizado. No se inició un servidor de desarrollo ni se enviaron cargos. Se conserva CSS adaptable para móvil; no se hizo una prueba visual en dispositivos reales.

Referencias: [actualización parcial de campos por API](https://help.storeganise.com/article/299-integration-example-case-study-sensorberg), [buenas prácticas de API](https://help.storeganise.com/article/297-api-best-practices), [pasos de ocupación](https://help.storeganise.com/article/159-jobs-move-ins).
