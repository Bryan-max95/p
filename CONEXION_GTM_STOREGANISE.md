# Storeganise → Pay por reserva

Actualización: 14 de octubre de 2026. Código implementado y revisado por lectura. No se ejecutaron pruebas, compilación, servidor ni cobros. La conexión desplegada no se ha validado.

## Etiqueta que debe publicarse

Reemplazar completamente la etiqueta HTML de pago anterior por [examples/gtm-storeganise-pago.html](examples/gtm-storeganise-pago.html). Mantener una sola etiqueta de pago y el activador All Pages. Publicar en Google Tag Manager y recargar la página de Storeganise para quitar los listeners de la versión anterior.

La etiqueta contiene estos destinos fijos:

    PAY_URL = https://www.payroatanselfstorage.com
    ENTRY_API = https://www.payroatanselfstorage.com/api/storeganise/reservation

Al pulsar el enlace de pago de una reserva, navega a la API de Pay con orderId y returnUrl. Esa API redirige a la página de Pay. Ya no navega a /api/v1/billing/custom de Storeganise. No extrae precios del HTML ni transmite nombres, correos, contraseñas, claves API o tarjetas en la URL.

Debe existir un orderId de 24 caracteres hexadecimales en el enlace nativo o en la página. Si hay dos IDs distintos, la etiqueta detiene la navegación. El botón de añadir tarjeta de un perfil sin reserva no permite saber qué reserva desea pagar el cliente: el cliente debe iniciar el pago desde su reserva. No se elige automáticamente la última reserva.

## Identificación del cliente

Las cookies del portal Storeganise no se transfieren a otro dominio. Esta versión añade una confirmación de acceso en Pay con el correo y contraseña de la cuenta de Storeganise. No es un acceso transparente: la primera vez, o al vencer la sesión de 30 minutos, el cliente verá ese formulario antes del carrusel.

Pay envía esas credenciales únicamente al endpoint de autenticación de la instancia configurada. La contraseña no se guarda. El token de cliente queda cifrado en una cookie HttpOnly, Secure y SameSite=Strict de Pay; no se devuelve a JavaScript ni se pone en la URL. El inicio de sesión tiene límites persistentes por dirección y cuenta. Esto requiere que la cuenta permita el acceso por contraseña documentado por Storeganise; no implementa OAuth/SSO, CAPTCHA o verificación OTP adicional. Para eliminar esta confirmación se necesita un handoff autenticado soportado por Storeganise; una redirección por GTM no lo sustituye.

POST /api/storeganise/reservation acepta solamente orderId y returnUrl desde el mismo origen de Pay. Usa el token del cliente para consultar /api/v1/user y /api/v1/units/orders/{orderId}?include=invoicePreview, y verifica el propietario mediante /api/v1/admin/jobs/{orderId}. El nombre y los datos de facturación se consultan en Storeganise. Se obtiene el total de invoicePreview.total, no el precio anunciado del tipo de bodega ni un valor enviado por el navegador.

## Carrusel sin factura previa

Para abrir el carrusel no hace falta una factura fiscal ni una factura interna ya creada. Pay crea una sesión por reserva con su cliente, selección de bodega, total USD y conversión BCH a HNL. Si la bodega concreta aún no está asignada, muestra el tipo reservado sin afirmar que ya está ocupado.

El cliente revisa el total y pulsa Confirmar reserva y pagar. Antes de autorizar la tarjeta, Pay vuelve a consultar la reserva, verifica el total y solicita submitNow mediante la API del propio cliente, como hace la revisión final del portal. No omite firmas ni requisitos mediante la API administrativa. Un intento de envío queda registrado antes de hacerlo, para que una respuesta perdida no cause envíos repetidos.

Para cobrar y registrar el dinero, Storeganise debe haber confirmado la entrada y creado su factura interna cobrable. Esa factura es su registro contable, no la factura fiscal del portal. Si todavía falta confirmación, asignación, firma o emisión interna, el cliente ve el motivo y no se inicia un cobro. Las automatizaciones de Storeganise deben completar esos pasos para que el recorrido sea continuo. Si el total cambia, debe abrir nuevamente el pago y revisar el nuevo total.

La sesión por reserva se convierte en sesión vinculada a esa misma factura; no se crea un segundo cobro. Los bloqueos y la referencia por reserva/factura evitan duplicados entre aperturas y webhooks. Se conserva la conversión fijada mientras la sesión esté vigente.

## Después del pago

El procesamiento existente confirma la transacción CyberSource, registra el pago externo con método card en Storeganise y comprueba el saldo. Solo informa bodega activa cuando Storeganise devuelve occupied para el mismo cliente y alquiler. La factura fiscal sigue perteneciendo al portal y su conexión existente con Storeganise.

billing.list continúa sin tarjetas guardadas y billing.charge no hace cargos recurrentes. Esta etiqueta implementa un pago puntual por reserva; no registra un método reutilizable en Storeganise. La automatización no debe intentar otro cobro bancario por billing.charge: la recaudación se realiza en Pay y después se registra como pago externo en Storeganise.

## Despliegue

1. Desplegar el código actualizado en Vercel antes de publicar la etiqueta.
2. Usar PAY_PUBLIC_URL=https://www.payroatanselfstorage.com, DATABASE_URL y PAY_SESSION_TOKEN_SECRET privado de al menos 32 caracteres. El esquema agrega la tabla de límites y el indicador de envío de reserva al inicializarse; no se ha ejecutado una migración desde esta revisión.
3. Activar STOREGANISE_PAY_ENABLED=true y configurar API URL, API key, secreto real del webhook, BCH y CyberSource según [.env.example](.env.example). No pegar secretos en GTM.
4. Mantener entornos compatibles: producción con Storeganise .com; sandbox bancario solo con instancia Storeganise .dev y clientes de prueba autorizados. Esta revisión no cambió el entorno bancario ni las credenciales.
5. Configurar permisos para leer las entidades, registrar pagos y, si está habilitado, completar únicamente el paso de factura pagada. Revisar automatizaciones de confirmación/emisión/ocupación en Storeganise. Ver [CONFIGURACION_STOREGANISE.md](CONFIGURACION_STOREGANISE.md).
6. Publicar la etiqueta y recargar Storeganise. Cuando se autoricen pruebas, verificar autenticación, total, confirmación de orden, cobro y activación. El código nuevo no acredita por sí solo el comportamiento de la cuenta externa.

Referencias oficiales: [autenticación en integraciones personalizadas](https://help.storeganise.com/article/305-custom-stripe-integration), [gestión de entradas y automatización](https://help.storeganise.com/article/159-jobs-move-ins). Las operaciones de reservas se contrastaron por lectura con el cliente público de Storeganise; el contrato completo de /api/docs de la cuenta sigue sin estar accesible con la clave disponible.
