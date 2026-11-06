# Corregir Añadir método de pago

Fecha: 6 de noviembre de 2026 (America/Chicago).

## Pedido y alcance

El usuario confirmó que pagar una reserva y activar su bodega ya funciona. Autorizó respaldar, corregir únicamente el acceso de Añadir método de pago y subir los cambios al repositorio. Proporcionó el script V9 que usa en Google Tag Manager.

## Respaldo previo

- `respaldos/2026-11-06/pay-antes-metodos-pago-aeba8ca.zip`: código versionado antes de los cambios, commit `aeba8ca`, sin archivos de secretos.
- SHA256: `F8402A8E1FDC3C6B452928660DC78ABA71029DBCE5FDAED927665F03A9A10725`.
- `respaldos/2026-11-06/gtm-v9-original.html`: copia del script entregado, antes de modificarlo.

## Qué hicimos

- Confirmamos por consulta de solo lectura que la cuenta Storeganise tiene un sitio. El script original exigía un siteId ausente en Billing y fallaba antes de llamar al backend.
- Creamos sesiones, grants y métodos guardados en tablas propias. El registro no acepta ni inicia pagos de reservas.
- Agregamos `prepare_payment_method` y `redeem_payment_method`, con prueba privada mediante el perfil autenticado y preservación de grants de reserva.
- Completamos `billing.checkout` sin orderId y `billing.list`, manteniendo la validación de firma de los webhooks.
- Creamos el carrusel de cuenta reutilizando los campos seguros existentes de CyberSource. Solicita registro mediante autorización cero sin captura, muestra confirmación y regresa a Billing.
- Entregamos V9 completo corregido en `examples/gtm-storeganise-pago-v9.html`, sin cambiar las operaciones prepare/redeem de reservas.
- Añadimos documentación técnica en `METODOS_PAGO_CUENTA.md` y pruebas de los dos accesos GTM y del backend de métodos.

## Archivos principales

- Nuevos: `lib/storeganise/payment-methods.ts`, `payment-method-bridge.ts`, `app/api/pay/payment-method/route.ts`, `app/components/payment-method-carousel.tsx`, `examples/gtm-storeganise-pago-v9.html`, `tests/payment-methods.test.ts`, `METODOS_PAGO_CUENTA.md`.
- Actualizados: manejadores y ruta Billing, protocolo y ruta bridge, preservación de grants en `bridge.ts`, esquema SQL, gateway y tipos CyberSource, componente de campos seguros, página principal, pruebas GTM y README.

## Verificaciones

- TypeScript y compilación de producción correctos.
- 23 pruebas dirigidas de métodos, GTM y gateway de producción pasaron, incluyendo el V9 real corregido para cuenta y reserva.
- Prueba en Microsoft Edge sin interfaz con la aplicación compilada: apertura de sesión, paso de tarjeta, datos de facturación, guardado y confirmación correctos, usando proveedor y API simulados. Se comprobó que la interfaz de cuenta no llama endpoints de pago de reserva. El navegador Chromium de Playwright no estaba instalado; se utilizó Edge instalado.
- Batería completa inicial con los seis tests de métodos: 115 tests, 88 correctos y 27 fallidos. Se ejecutó el código original desde el ZIP: 109 tests, 82 correctos y exactamente los mismos 27 fallos. Se compararon sus nombres; no hubo fallos adicionales. Son fallos preexistentes, muchos de sandbox histórico.
- Lint dirigido pasó. El lint global falla por código privado descargado y un componente anterior de retorno de reservas.
- No se registró una tarjeta real, no se cobró una reserva y no se modificaron variables privadas.

## Pendientes externos

- Sustituir y publicar la etiqueta completa en Google Tag Manager; GitHub no publica GTM.
- Confirmar despliegue de Vercel y habilitación bancaria de TMS y autorizaciones de importe cero.
- Verificar con el comercio el registro real, el regreso y visualización en Billing, y el recorrido real de reserva, factura y activación. Los tests simulados no certifican estos pasos.
- Typecheck, compilación final y lint de archivos modificados pasaron. La subida autorizada se realizará al terminar esta nota; su resultado se registrará después.
