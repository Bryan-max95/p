# Storeganise y Pay

Estado del código al 14 de octubre de 2026. Implementado, sin ejecutar validaciones de esta actualización.

## Entrada desde la reserva mediante GTM

El recorrido del botón de pago ahora utiliza [CONEXION_GTM_STOREGANISE.md](CONEXION_GTM_STOREGANISE.md): GTM abre la API /api/storeganise/reservation de Pay; Pay autentica al cliente con su cuenta Storeganise y consulta su reserva y total. El carrusel puede abrirse sin factura interna previa. Al confirmar y pagar, el servidor envía la reserva y exige que Storeganise confirme su registro interno cobrable antes de autorizar la tarjeta. La factura fiscal del portal sigue siendo posterior al pago.

Este recorrido incluye un inicio de sesión en Pay cuando no existe una sesión de cliente válida de Pay. El inicio de sesión que ya existe en otro dominio no se transfiere mediante una URL. Ver el archivo de conexión para publicar la etiqueta, los requisitos de autenticación y las automatizaciones pendientes de comprobar.

## Punto de entrada alternativo firmado, con factura interna

Pay recibe una factura interna de Storeganise ya creada, emitida y con saldo pendiente. Esa factura identifica la deuda; la factura fiscal continúa siendo responsabilidad del portal del comercio.

El servidor que atiende al usuario autenticado debe solicitar el enlace mediante POST a:

    https://payroatanselfstorage.com/api/storeganise/checkout

Cabeceras: Content-Type: application/json y sg-signature, calculada como Base64 de HMAC-SHA256 del cuerpo JSON exacto con STOREGANISE_WEBHOOK_SECRET.

Cuerpo de ejemplo; sustituir los IDs por los registros del cliente autenticado:

    {
      "type": "pay.checkout",
      "data": {
        "userId": "ID_STOREGANISE_DE_24_HEXADECIMALES",
        "invoiceId": "ID_FACTURA_DE_24_HEXADECIMALES",
        "returnUrl": "https://roatanselfstorage.storeganise.com/"
      }
    }

Respuesta:

    {"url":"https://payroatanselfstorage.com/?session=TOKEN_DE_UN_SOLO_USO"}

El servidor devuelve esa URL al navegador para redirigirlo. Puede enviar orderId o jobId en lugar de invoiceId si identifica una entrada unit_moveIn cuyo result.invoiceId ya existe. No enviar una orden de presupuesto ni escoger la última factura del cliente. No se recibe monto del navegador.

La función [examples/storeganise-handoff.ts](examples/storeganise-handoff.ts) muestra la firma y la petición. Se integra en el servidor/add-on que autentica al cliente, nunca en JavaScript público. Pay verifica por API las relaciones usuario → factura → alquiler → bodega y conserva esos IDs durante todo el pago.

## Qué configurar en Storeganise

- Para la entrada alternativa firmada, un handoff después de crear y emitir la factura. Para la entrada por reserva, la etiqueta y API descritas arriba.
- API key con lectura de configuración, usuarios, facturas, alquileres, bodegas y entradas; además permiso para registrar pagos. Si se activa la finalización del paso de factura, también necesita actualizar ese paso de la entrada.
- Un método de pago externo con código card, o su código real en STOREGANISE_CARD_PAYMENT_METHOD. El registro API usa type manual porque el banco cobra fuera de Storeganise; el método mostrado corresponde al código de tarjeta configurado.
- Automatizaciones y requisitos de entrada que permitan completar la ocupación después de pagar. Pay no firma contratos, aprueba identidad ni modifica directamente la bodega para saltar pasos.
- Secreto real de firma, igual al valor privado STOREGANISE_WEBHOOK_SECRET de Pay.

El flujo nativo billing.checkout está orientado a agregar un método de pago y puede ejecutarse antes de confirmar la orden. La aplicación de Pay admite un handoff con factura, pero no implementa un proveedor de tarjetas guardadas ni cargos recurrentes: billing.list devuelve una lista vacía y billing.charge exige acción del cliente. No habilitar esos eventos como sustituto del handoff descrito arriba. Cuando todavía no existe una factura, responde ORDER_REQUIRES_CONFIRMED_INVOICE.

## Webhooks de seguimiento

URL:

    https://payroatanselfstorage.com/api/storeganise/billing

Seleccionar:

- invoice.payments.updated
- invoice.state.updated
- invoice.deleted
- job.unit_moveIn.completed
- job.unit_moveIn.cancelled
- unit.occupied
- unit.unassigned
- unitRental.updated

Estos eventos despiertan la conciliación de una sesión existente. No crean cobros, no fijan importes y no bastan para redirigir al navegador. Pay autentica la firma y vuelve a leer Storeganise; un evento no se acepta como prueba de que el banco cobró.

## Registro después del cobro

La transacción bancaria confirmada crea una entrega persistente en storeganise_deliveries. El trabajador comprueba nuevamente cliente, factura y alquiler y utiliza:

    POST /api/v1/admin/invoices/{invoiceId}/payments

Campos: type manual, method card (configurable), amount en USD, date y notes. Las notas conservan la referencia única Pay/CyberSource, el cargo HNL y la tasa BCH. Esto aplica el valor original a la factura USD, aunque la tarjeta haya sido cobrada en HNL.

La lectura posterior debe encontrar ese registro y saldo cero con estado paid. Con STOREGANISE_COMPLETE_PAID_INVOICE_STEP=true se completa exclusivamente el paso invoice_createInitial que esté ready y apunte a esa factura:

    PUT /api/v1/admin/jobs/{jobId}/steps/{stepId}
    {"state":"completed"}

La bodega solo se muestra habilitada cuando Storeganise devuelve state occupied, ownerId del cliente y rentalId del alquiler de la sesión. Pagar no permite omitir otros requisitos de entrada.

## Estados de confirmación

| Estado | Significado |
| --- | --- |
| pending / retry | Cobro guardado; entrega a Storeganise pendiente. |
| awaiting_move_in | Pago aplicado; todavía falta completar la entrada. |
| active | Pago aplicado y ocupación comprobada para ese cliente. |
| review | Se requiere revisión del registro o de la entrada; no repetir el cargo. |

Los reintentos usan un bloqueo persistente para evitar entregas simultáneas. Antes de registrar el pago se busca su referencia exacta en la factura. Si una escritura pudo llegar pero su respuesta se perdió, se conserva payment_write_started=true y solo se consulta hasta localizarla: no se repite automáticamente el POST.

Para un estado review, revisar storeganise_deliveries.last_error y la referencia CyberSource en la factura. Si el pago existe, conservarlo; el trabajador lo reconocerá por sus notas. Si la escritura quedó sin confirmar, resolverla con el registro real y la respuesta de Storeganise antes de cualquier corrección administrativa. No borrar la sesión ni reiniciar el indicador para intentar cobrar otra vez.

## Configuración por entorno

Producción: CYBERSOURCE_ENVIRONMENT=production, API de Storeganise .storeganise.com y STOREGANISE_PAY_ENABLED=true.

Sandbox: CYBERSOURCE_ENVIRONMENT=sandbox, instancia aislada .storeganise.dev y IDs reales de prueba en STOREGANISE_TEST_CUSTOMER_IDS. El código bloquea aplicar una aprobación ficticia del banco a la instancia real. El formulario manual sandbox continúa funcionando con STOREGANISE_PAY_ENABLED=false y no registra pagos en Storeganise.

Si al perfil le falta una dirección bancaria completa, Pay la solicita antes del cobro. Opcionalmente puede suministrarse un objeto billTo completo en el campo personalizado pay_billTo del usuario; no se inventan direcciones para clientes reales.

El portal fiscal permanece fuera de este proyecto. La conexión Storeganise → portal debe recibir sus propios eventos de pago según la configuración existente del comercio.

Referencias: [webhooks de Storeganise](https://help.storeganise.com/article/19-webhooks), [métodos de pago en aplicaciones de reserva](https://help.storeganise.com/article/471-add-payment-methods-custom-booking-app), [automatizaciones](https://help.storeganise.com/article/257-storeganise-automations?type=help-docs).

