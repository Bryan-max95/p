# Activación automática después de una transacción confirmada

Actualización: 16 de octubre de 2026. Pay puede registrar una aprobación sandbox en la cuenta real de Storeganise y completar su ocupación, mediante autorización explícita guardada en cada checkout nuevo. No modifica la conexión bancaria, Microform, 3DS, BCH ni la identificación por GTM.

## Variables de Vercel

Conservar las claves, secretos y base de datos actuales. Para el flujo solicitado:

```dotenv
CYBERSOURCE_ENVIRONMENT=sandbox
STOREGANISE_PAY_ENABLED=true
STOREGANISE_BRIDGE_ENABLED=true
STOREGANISE_LIVE_SANDBOX_ENABLED=true
STOREGANISE_SANDBOX_ACTIVATION_ENABLED=true
STOREGANISE_COMPLETE_PAID_INVOICE_STEP=true
STOREGANISE_CARD_PAYMENT_METHOD=card
STOREGANISE_API_URL=https://roatanselfstorage.storeganise.com/api/v1/admin
PAY_PUBLIC_URL=https://www.payroatanselfstorage.com
PAY_DEMO_ENABLED=false
PAY_SANDBOX_MANUAL_ENABLED=false
```

La variable nueva es `STOREGANISE_SANDBOX_ACTIVATION_ENABLED`. Guardar en Production, redesplegar y comenzar con una reserva nueva. No hace falta una lista de clientes. La tarjeta se sigue escribiendo manualmente. La API key necesita permisos de lectura, registro de pagos y actualización de pasos del job.

La autorización se guarda en `storeganise_context.sandboxActivation`. Una sesión existente conserva su modo original: cambiar variables no aplica aprobaciones antiguas ni transforma sesiones abiertas previamente. Para probar este modo, usar una reserva/sesión creada después de desplegar y habilitarlo. Desactivar la variable afecta nuevas sesiones; no revoca entregas de sesiones ya autorizadas. `STOREGANISE_PAY_ENABLED=false` detiene el trabajador global si se necesita detener la integración.

## Flujo

1. Storeganise entrega la identidad y la reserva mediante el bridge existente. Pay calcula el total y revalida propietario e importe antes de enviar el pago.
2. Solo el resultado bancario `succeeded` crea la entrega persistente. Rechazos, autorizaciones sin captura confirmada y resultados inciertos no activan nada.
3. Si la sesión aún representa una reserva provisional, el trabajador vuelve a comprobar el total y completa sus pasos administrativos conocidos de envío/confirmación. Lee la factura interna generada y vincula sus IDs exactos al pago aprobado.
4. Registra un solo pago `type=manual`, `method=card`, por el importe USD original, con referencia CyberSource, importe HNL, tasa BCH y una nota explícita de SANDBOX cuando corresponda. No vuelve a cobrar en el banco.
5. Comprueba que el pago esté en la factura y el saldo sea cero. Completa el paso de factura y el paso final de ocupación mediante `PUT /api/v1/admin/jobs/{jobId}/steps/{stepId}` con `state=completed`.
6. Solo muestra `active` cuando la API devuelve la bodega `occupied`, con el propietario y alquiler correctos. Los demás estados muestran registro/activación pendiente o revisión, sin invitar a pagar otra vez.

Los pasos admitidos son `await_submitOrder`, `await_confirmOrder`, `order_confirm` para confirmar; `invoice_createInitial`, `await_chargeInvoice`, `invoice_confirm` para pago; `await_confirmMovedIn`, `confirm_occupy` para finalizar. Solo se actualiza el primer paso `ready` del job correcto. No se usan operaciones `skip`, no se inventan firmas/verificaciones y no se reasigna una bodega de otro cliente. La confirmación final solicita ocupación inmediata, incluso si la fecha de entrada es futura, conforme al comportamiento solicitado; no cambia la fecha ni marca subtareas como firmadas. Si la API impone un requisito adicional, se conserva el estado pendiente/revisión y su referencia, en lugar de afirmar una activación inexistente.

El contrato de actualización de pasos se contrastó con el cliente administrativo de Storeganise guardado localmente y con [la documentación de ocupaciones](https://help.storeganise.com/article/159-jobs-move-ins). Los permisos y el comportamiento de esta cuenta deben verificarse en el despliegue; no se ejecutaron escrituras en Storeganise ni transacciones bancarias durante el desarrollo.

## Duplicados y recuperación

- `storeganise_deliveries` conserva cada entrega y su bloqueo entre procesos. Antes del POST de pago se busca la referencia exacta en la factura; una escritura de pago incierta se consulta sin repetirla.
- La tabla aditiva `storeganise_step_operations` registra cada paso antes de enviarlo. Tras una respuesta perdida, se lee el job y se continúa desde su estado observado. No se repite ciegamente el mismo PUT. La tabla se crea mediante el esquema existente al primer acceso; no se borra información.
- `Repetir prueba` está deshabilitado para sesiones con activación real. Una reserva ya pagada no se reinicia. Se conservan los intentos y comprobantes.
- La consulta de estado y los webhooks despiertan las entregas; el cron existente también recupera pendientes. No se necesita cambiar GTM ni añadir eventos.
- Los fallos se guardan en `storeganise_deliveries.last_error` y en Vercel como `[PAY_STOREGANISE_SYNC]`, con código e ID de sesión, sin tarjetas, claves ni respuestas privadas del proveedor.

## Efectos y validación

Si el carrusel no abre y aparece `V8 / STOREGANISE_BRIDGE_UNAVAILABLE`, todavía no se ha llegado al pago bancario. El endpoint `/api/storeganise/bridge` registra ahora `[PAY_STOREGANISE_BRIDGE]` con `stage`, `code` y `diagnosticId`. La misma referencia aparece en la respuesta JSON y en `X-Pay-Diagnostic-Id`; no hace falta cambiar el script V8 existente.

- `BCH_*`: no se pudo obtener una tasa válida o hay un problema con su configuración.
- `PAY_DATABASE_UNAVAILABLE`: revisar el código técnico `dependencyCode` del registro de Vercel.
- `STOREGANISE_API_*`: revisar la conexión, configuración o respuesta de Storeganise según el código.
- `ORDER_NOT_ACTIVE`: Storeganise considera la reserva abandonada, cancelada, vencida o fallida. Iniciar una nueva reserva; cambiar variables o recargar Pay no reactiva la anterior.

Pay acepta `result.unitId: null` cuando la reserva activa aún tiene una selección por tipo de unidad. Sigue comprobando propietario, estado y total; no permite cobrar una reserva abandonada ni considera asignada una bodega sin confirmación de Storeganise.

CyberSource sandbox no ingresa dinero en el banco. Este modo sí registra un pago y puede ocupar una bodega real; los eventos reales de Storeganise pueden activar el portal fiscal existente. Pay no envía facturas directamente al Portal. Las notas y la pantalla conservan la condición de prueba bancaria.

Las comprobaciones locales usan PostgreSQL y APIs simuladas: aprobación, rechazo/resultado incierto, reserva correcta, propietario ajeno, importe cambiado, sesiones históricas, entrega concurrente, respuesta perdida, pago único y lectura final de ocupación. No se inicia el proyecto ni se usa la cuenta externa para probar. La validación integral desplegada permanece a cargo de la prueba manual del operador.
