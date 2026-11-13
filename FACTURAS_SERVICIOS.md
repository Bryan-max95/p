# Pago de facturas y servicios desde la cuenta — GTM V10

El botón de pago de `/account/invoices/<referencia>` abre el carrusel Pay con el concepto y saldo pendiente de esa factura. El enlace nativo `/api/v1/billing/custom`, que mostraba HTTP 404, se reconoce como botón y no se solicita. Un `orderId` vacío no impide este acceso.

## Entrega e instalación

Paquete local con los archivos modificados y su manifiesto SHA256: `entregas/2026-11-12/pay-facturas-v10.zip`. Se aplica sobre este proyecto; no es una instalación independiente. No contiene credenciales ni dependencias. Los ZIP de entrega y respaldos permanecen en el equipo local.

1. Publicar el backend incluido en esta entrega en el proyecto Pay. El esquema existente de inicialización crea `pay_invoice_bridge_grants`; no cambia tablas ni importes de reservas. No requiere nuevas variables de entorno: utiliza las conexiones, credenciales y el campo privado de entrega `pay_checkout_bridge` ya configurados.
2. Verificar que el despliegue esté listo. Consultar el estado de la subida a GitHub y del despliegue en [seguimiento/README.md](seguimiento/README.md). El usuario publica manualmente la etiqueta de GTM.
3. Reemplazar toda la etiqueta anterior por el bloque de [SCRIPT_GTM_V10_COMPLETO.md](SCRIPT_GTM_V10_COMPLETO.md). Mantener una sola etiqueta de pago activa y conservar las rutas anteriores en el activador. Incluir también `/account/invoices/…` si el activador estaba restringido a reserva y Billing.
4. Publicar GTM y recargar la cuenta. No es necesario poner precios, claves o tokens en el script. El sitio de la factura se resuelve en Pay.
5. Con una transacción autorizada, comprobar una factura pendiente: referencia, concepto y saldo correctos; cobro BAC/CyberSource; estado pagado en Storeganise y regreso a la misma factura. Comprobar también una reserva y añadir tarjeta. Las verificaciones de esta entrega simulan proveedores; no sustituyen la comprobación bancaria real.

## Recorrido y límites

- `prepare_invoice` recibe `userId`, `invoiceRef` y opcionalmente `siteId`. La referencia admite el código SID mostrado por Storeganise o su ID. Pay consulta la factura mediante su API, verifica propietario, sitio, moneda y saldo pagable y entrega un permiso temporal solo al perfil de su dueño. La respuesta pública es `{prepared:true}`.
- El navegador vuelve a leer el perfil con la sesión de Storeganise y canjea ese permiso con `redeem_invoice`. Pay verifica su token, factura, sitio, instancia, entorno, vencimiento y navegador. El destino de retorno debe pertenecer al dominio autorizado y a esa factura. No se envían claves de Storeganise ni cookies del cliente a Pay.
- El servidor genera una sesión con `kind: account_invoice`. El precio procede del saldo en USD de la API; el cobro en HNL utiliza la cotización BCH guardada. El concepto procede de las descripciones de la factura. Un servicio sin alquiler o bodega asociados también puede pagarse.
- Antes de autorizar el cobro se vuelven a comprobar el propietario, sitio, estado, saldo y cliente. El navegador no fija el monto. Facturas pagadas, en borrador o con un cobro ya pendiente no se ofrecen para un nuevo cargo.
- El cobro conserva el proceso BAC/CyberSource existente. Después de una aprobación confirmada, el reconciliador registra un pago externo por tarjeta en **esa factura**, por su saldo original en USD, anotando el importe bancario en HNL.
- El estado `invoice_paid` se establece después de releer y verificar el pago, su referencia bancaria, importe y saldo final cero. Una respuesta ambigua queda en revisión y no repite la escritura financiera. Un cobro rechazado o incierto no declara pagada la factura.
- El cliente ve la referencia, concepto, monto y comprobante. El retorno automático ocurre después de confirmar `invoice_paid`; elimina `?pay` para no reabrir otro pago. Si el registro necesita revisión, conserva el comprobante y muestra ese estado.
- La primera factura de una reserva conserva su manejador de activación existente. Las facturas posteriores o de servicios se pagan sin ejecutar operaciones de ocupación de bodega.
- `prepare`/`redeem`, el registro de tarjetas y `billing.checkout`/`billing.list` mantienen sus recorridos. V10 parte del script proporcionado por el usuario, incluido el ajuste de Billing que ignora su `orderId` nativo.

## Verificación realizada

- 31 pruebas de script y facturas: correctas. Incluyen sesiones, propietario, sitio, saldo, caducidad, reintentos, retorno, registro de pago, respuesta perdida, factura inicial y conservación de reservas y registro de tarjetas.
- TypeScript y compilación de producción: correctos. Lint dirigido: correcto.
- Microsoft Edge sin interfaz, contra la aplicación compilada y con APIs simuladas: resumen de factura, monto USD/HNL, tarjeta, confirmación pendiente, factura pagada y retorno correctos. También se comprobó el carrusel de registro de tarjeta.
- La suite general produjo los mismos 27 fallos preexistentes que el código del respaldo `cefc515`; se compararon los nombres y no apareció ninguno adicional. No se corrigieron los tests históricos ajenos a este cambio.
- No se realizó un cobro, registro de tarjeta ni pago de factura real. Se consultó Storeganise en modo lectura para confirmar la identificación por SID; no se incluyen datos de clientes en esta documentación.

Comandos de las pruebas dirigidas:

```powershell
node --import tsx --test tests/storeganise-invoices.test.ts tests/gtm-storeganise.test.ts
pnpm typecheck
pnpm build
# Con la aplicación compilada ejecutándose localmente en localhost:3100:
node scripts/check-invoice-carousel.cjs
```

Respaldo previo: `respaldos/2026-11-12/pay-antes-facturas-cefc515.zip`. También se conservaron el script original aportado, el Markdown anterior y el índice previo de seguimiento. Los respaldos no contienen variables de entorno ni credenciales.
