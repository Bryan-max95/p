# Entregar script completo GTM en Markdown

Fecha: 6 de noviembre de 2026 (America/Chicago).

## Pedido

El usuario pidió el script completo corregido dentro de un `.md`, listo para copiar a Google Tag Manager, después de ver `PAYMENT_METHOD_CONTEXT_INVALID` al añadir tarjeta desde Billing.

## Qué hicimos

- Creamos `SCRIPT_GTM_V9_COMPLETO.md` con instrucciones breves y el bloque HTML completo, incluyendo sus etiquetas script.
- La versión entregada elimina, únicamente en el acceso de cuenta, el bloqueo por orderId en la página o enlace. Las operaciones de registro no envían ese identificador al backend.
- Conservamos el flujo de reservas y las validaciones de sitio, identidad, grant y destino.
- No modificamos el backend ni el archivo HTML fuente anterior. El Markdown contiene la nueva versión corregida; usar ese contenido para reemplazar toda la etiqueta publicada.

## Verificación

Se extrajo el script del Markdown y se validó su sintaxis JavaScript. Pasaron 11 pruebas del navegador simulado, usando para el acceso de cuenta un enlace que incluye orderId. También se verificó que las reservas mantienen prepare/redeem y su destino original. No se realizaron cobros ni registros bancarios reales.

## Archivos

- `SCRIPT_GTM_V9_COMPLETO.md` (nuevo).
- Esta nota (nueva).
- `seguimiento/README.md` (actualizado).

## Dónde quedamos

Entregamos el Markdown para copiar el bloque completo en GTM, publicar una sola etiqueta de pagos y recargar Billing. No se publicó GTM ni se subieron nuevos commits en esta tarea. El despliegue backend y la habilitación bancaria deben estar disponibles para completar un registro real.
