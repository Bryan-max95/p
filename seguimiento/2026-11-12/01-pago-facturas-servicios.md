# Pago de facturas de servicios desde la cuenta

Fecha local: 2026-11-12, America/Chicago.

## Pedido

Entregar el script GTM completo que conserve los recorridos de reserva y registro de tarjeta y agregue el pago de una factura o servicio. El usuario mostró un enlace nativo `billing/custom` que termina en HTTP 404, con retorno a una factura y `orderId` vacío. Quiere el mismo carrusel, ver qué servicio y monto paga, y que Storeganise muestre pagada esa factura.

## Respaldo previo

- `respaldos/2026-11-12/pay-antes-facturas-cefc515.zip`: código rastreado de HEAD antes del cambio, generado con git archive.
- SHA256: `06DF2D70AA03F63BF9E490FA8712925A98353AF7CFF8AF330E06F7F16C2FE875`.
- En esa carpeta se guardaron también `gtm-original-usuario.html`, `SCRIPT_GTM_V9_COMPLETO-anterior.md` y `seguimiento-indice-anterior.md`.
- Se conservaron el Markdown V9 y la nota anterior que ya estaban sin confirmar en Git. No se incluyeron credenciales ni variables de entorno en los respaldos.

## Qué se hizo

- Se confirmó mediante consultas de solo lectura que la API de Storeganise admite tanto el ID como el SID de la factura del enlace de cuenta. No se copiaron datos de clientes a las notas.
- Se creó V10 a partir del script exacto entregado por el usuario; se mantiene su corrección de Billing. Se añade interceptación del botón de pago en `/account/invoices/<referencia>`, sin llamar a la ruta nativa que fallaba. La factura no exige `orderId`.
- Se añadieron `prepare_invoice` y `redeem_invoice` al bridge. La sesión se entrega al dueño mediante el perfil autenticado; tiene validaciones de factura, propietario, sitio, instancia, token, vencimiento, navegador y destino. Se preservan los permisos de reserva y registro de tarjeta al actualizar el perfil.
- Se añadió una sesión `account_invoice` para servicios con o sin alquiler. Su referencia, concepto, saldo y sitio proceden del servidor. El monto USD se convierte a HNL usando la lógica BCH existente. Se reutiliza una sesión por factura y se vuelve a comprobar el saldo antes de cobrar.
- Se reutiliza el cobro BAC/CyberSource y la entrega durable a Storeganise. La nueva modalidad registra el pago en la factura exacta, lo relee y solo entonces muestra `invoice_paid`. No activa otra reserva ni bodega. La factura inicial de una reserva sigue por el manejador anterior de activación.
- El carrusel muestra referencia, concepto y saldo. Distingue cobro confirmado de pago registrado en Storeganise; conserva el comprobante cuando hay revisión. Regresa automáticamente a la factura después de verificarla, sin `?pay`.
- Se prepararon el Markdown completo, instrucciones técnicas y `entregas/2026-11-12/pay-facturas-v10.zip`, con 24 archivos y un manifiesto SHA256. Es un paquete de cambios sobre este proyecto, sin dependencias ni credenciales. No se publicaron GitHub, Vercel ni GTM en esta tarea.

## Archivos modificados

- Nuevos: `SCRIPT_GTM_V10_COMPLETO.md`, `FACTURAS_SERVICIOS.md`, `examples/gtm-storeganise-pago-v10.html`, `lib/storeganise/invoice-bridge.ts`, `lib/storeganise/invoice-checkout.ts`, `tests/storeganise-invoices.test.ts`, `scripts/check-invoice-carousel.cjs`.
- Bridge: `lib/storeganise/bridge-protocol.ts`, `bridge-diagnostics.ts`, `bridge.ts`, `records.ts`, `checkout.ts` y `app/api/storeganise/bridge/route.ts`.
- Sesiones y registro: `lib/pay/schema.ts`, `types.ts`, `service.ts`, `lib/storeganise/sync.ts` y `app/api/pay/session/route.ts`.
- Interfaz: `hooks/use-payment-session.ts`, `app/components/payment-carousel.tsx`, `storeganise-return.tsx`.
- Pruebas GTM: `tests/gtm-storeganise.test.ts`.
- Seguimiento: esta nota e índice `seguimiento/README.md`.

## Verificaciones y resultados

- 31 pruebas dirigidas correctas de GTM y facturas. Verifican los tres accesos, la referencia SID y `orderId` vacío, perfiles y destinos incorrectos, saldos, facturas no pagables, deduplicación, respuesta perdida, factura inicial de reserva y resultados rechazados o inciertos.
- TypeScript y compilación de producción correctos; lint dirigido y `git diff --check` correctos. La compilación advirtió sobre la caché de Webpack, pero terminó con éxito.
- Suite completa antes de agregar las dos últimas pruebas: 136 pruebas, 109 correctas y 27 fallidas. Se extrajo el ZIP previo a `.private/invoice-baseline-cefc515` y se ejecutó su suite: 118 pruebas, 91 correctas y 27 fallidas. Se compararon los nombres de los 27 fallos y son idénticos. Muchos corresponden al sandbox histórico, que el entorno bancario actual no admite. Las dos pruebas finales adicionales pasaron dentro del grupo dirigido de 31.
- Navegador Microsoft Edge sin interfaz contra la compilación local: factura, USD/HNL, carrusel de tarjeta, confirmación pendiente, factura pagada y regreso correctos, con APIs y banco simulados. Se comprobó que el navegador no envía precio ni una confirmación de reserva para un servicio. El carrusel de guardar tarjeta también pasó con servicios simulados.
- No se hicieron cobros, registros de tarjeta ni pagos reales, ni cambios de variables privadas. La compilación local no es un despliegue.

## Pendiente y siguiente paso

Publicar el backend de esta entrega en Pay y confirmar su despliegue antes de reemplazar/publicar V10 en GTM. Incluir las páginas de facturas en el activador y mantener una sola etiqueta de pagos. Después validar, con una transacción autorizada, el cobro BAC real y su factura pagada en Storeganise, además de reserva/activación y añadir tarjeta. El resultado real sigue pendiente; los tests simulados no lo certifican.
