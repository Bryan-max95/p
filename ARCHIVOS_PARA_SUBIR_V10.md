# Archivos para publicar Pay V10 y script completo para GTM

Entrega: 2026-11-12. Se aplica sobre el proyecto Pay actual, que ya tiene las reservas y el registro de tarjetas. Es un paquete de actualización con los archivos completos en sus carpetas originales.

Paquete: `entregas/2026-11-12/pay-v10-archivos-para-subir.zip`.

## 1. Archivos de la aplicación

Estos **16 archivos** deben quedar en el proyecto antes de desplegar Pay. Copia cada archivo completo a la ruta indicada, desde la raíz donde está `package.json`.

| Acción | Ruta exacta | Cambio |
| --- | --- | --- |
| Agregar | `lib/storeganise/invoice-bridge.ts` | Acceso seguro desde la cuenta a la factura seleccionada. |
| Agregar | `lib/storeganise/invoice-checkout.ts` | Consulta la factura y crea o recupera su sesión de pago. |
| Reemplazar | `lib/storeganise/bridge-protocol.ts` | Admite `prepare_invoice` y `redeem_invoice`. |
| Reemplazar | `lib/storeganise/bridge-diagnostics.ts` | Identifica los errores de las operaciones nuevas. |
| Reemplazar | `lib/storeganise/bridge.ts` | Conserva los permisos de factura cuando se prepara una reserva. |
| Reemplazar | `lib/storeganise/records.ts` | Valida la referencia de factura usada por Storeganise. |
| Reemplazar | `lib/storeganise/checkout.ts` | Vuelve a verificar la factura antes del cobro. |
| Reemplazar | `lib/storeganise/sync.ts` | Aplica el cobro a esa factura y confirma el estado pagado. |
| Reemplazar | `lib/pay/schema.ts` | Añade la tabla de permisos temporales de factura. |
| Reemplazar | `lib/pay/types.ts` | Distingue las sesiones de factura y reserva. |
| Reemplazar | `lib/pay/service.ts` | Entrega a la interfaz la modalidad y referencia correctas. |
| Reemplazar | `app/api/storeganise/bridge/route.ts` | Conecta las dos operaciones nuevas con sus manejadores. |
| Reemplazar | `app/api/pay/session/route.ts` | Reconoce cuándo el pago de factura ya está registrado. |
| Reemplazar | `hooks/use-payment-session.ts` | Actualiza la confirmación en el navegador. |
| Reemplazar | `app/components/payment-carousel.tsx` | Muestra factura, concepto, saldo y comprobante en el carrusel. |
| Reemplazar | `app/components/storeganise-return.tsx` | Regresa a la factura después de confirmar su pago. |

Son **2 archivos nuevos y 14 reemplazos**. Los archivos completos ya están colocados en el proyecto de esta sesión. El ZIP permite trasladarlos a otra copia del mismo proyecto conservando las rutas.

## 2. Script nuevo de Google Tag Manager

El mismo script completo se entrega en dos formatos:

| Archivo | Uso |
| --- | --- |
| `SCRIPT_GTM_V10_COMPLETO.md` | Abre el documento y copia todo su bloque HTML, incluyendo `<script>` y `</script>`. |
| `examples/gtm-storeganise-pago-v10.html` | Contiene directamente el script completo para copiarlo. |

En GTM, reemplaza el contenido completo de la etiqueta de pago anterior por este script. Publica una sola etiqueta de pago. Conserva sus activadores de reserva y Billing y añade las páginas `/account/invoices/…` si el activador actual no las incluye. Después de publicar, recarga la página de Storeganise.

V10 conserva los recorridos anteriores y añade el pago de factura. El acceso de factura admite `orderId` vacío. El servidor obtiene el cliente, sitio, concepto y saldo de Storeganise. No hay que escribir precios ni claves en la etiqueta.

## 3. Archivos de pruebas y documentación incluidos

También puedes subir estos archivos al repositorio para conservar las pruebas, instrucciones y seguimiento:

| Acción | Ruta |
| --- | --- |
| Agregar | `tests/storeganise-invoices.test.ts` |
| Reemplazar | `tests/gtm-storeganise.test.ts` |
| Agregar | `scripts/check-invoice-carousel.cjs` |
| Agregar | `FACTURAS_SERVICIOS.md` |
| Agregar | `ARCHIVOS_PARA_SUBIR_V10.md` |
| Actualizar | `seguimiento/README.md` |
| Agregar si no existe | `seguimiento/2026-11-12/01-pago-facturas-servicios.md` |
| Agregar | `seguimiento/2026-11-12/02-entrega-archivos-para-subir.md` |

El paquete contiene **26 archivos del proyecto y `manifest-sha256.json`**, que permite comprobar su integridad. Mantiene la estructura `app/`, `hooks/`, `lib/`, `examples/`, `tests/`, `scripts/` y `seguimiento/`.

## 4. Orden de publicación

1. Extrae el ZIP y copia su contenido en la raíz del proyecto Pay, conservando las rutas. Los archivos de aplicación de esta entrega corresponden a los que se compilaron y probaron localmente.
2. Comprueba esa copia del proyecto:

   ```powershell
   pnpm typecheck
   node --import tsx --test tests/storeganise-invoices.test.ts tests/gtm-storeganise.test.ts
   pnpm build
   ```

3. Sube los cambios del proyecto y despliega el backend en Pay. Espera a que el despliegue nuevo esté disponible. La nueva tabla se crea mediante el inicializador de base de datos existente; no se requieren variables de entorno nuevas para este cambio. Conserva la configuración privada ya usada por el proyecto.
4. Publica la etiqueta GTM V10 después del backend. El script necesita las operaciones nuevas del bridge para abrir el pago de facturas.
5. Con una transacción autorizada, comprueba que el carrusel muestre el concepto y saldo de la factura seleccionada, que BAC confirme el cobro y que Storeganise la muestre pagada. Comprueba también los recorridos existentes de reserva/activación y añadir tarjeta.

El estado actualizado de la subida a GitHub y del despliegue está en [seguimiento/README.md](seguimiento/README.md). El usuario publica manualmente GTM. Las 31 pruebas dirigidas, la compilación y los recorridos de navegador se realizaron localmente; las pruebas de pago usaron proveedores simulados. El cobro real en producción sigue pendiente de comprobación.

Respaldo del proyecto anterior: `respaldos/2026-11-12/pay-antes-facturas-cefc515.zip`. Script anterior aportado por el usuario: `respaldos/2026-11-12/gtm-original-usuario.html`.
