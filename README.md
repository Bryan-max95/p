# Pay Roatan Self Storage

Carrusel de pago con tarjeta mediante CyberSource Microform y 3D Secure. Muestra el saldo en USD, calcula el cargo en HNL con la tasa BCH y guarda cliente, factura, bodega, cotización e intento en PostgreSQL.

Actualización del código: 15 de octubre de 2026. Pay admite temporalmente datos de Storeganise real con CyberSource sandbox mediante `STOREGANISE_LIVE_SANDBOX_ENABLED=true`, para todos los clientes autenticados sin una lista de IDs. Conserva la identificación y el total, permite escribir la tarjeta en Microform y repetir una prueba aprobada conservando su historial. Muestra el resultado como prueba, sin registrar pagos reales ni activar bodegas. Ver [configuración de Vercel](CONEXION_GTM_STOREGANISE.md#3-vercel-y-base-de-datos).

Se verificó el cambio con comprobaciones locales de TypeScript, ESLint y servicios simulados. No se iniciaron el servidor ni transacciones bancarias, ni se modificaron las cuentas externas. Las credenciales y el despliegue deben verificarse con la prueba manual del operador.

## Integración incorporada

Flujo de pagos reales, cuando CyberSource está en producción:

1. Un servidor autenticado de Storeganise envía a Pay el identificador del usuario y de la factura o entrada. Pay consulta la Admin API y comprueba a quién pertenece cada registro; el navegador no fija el saldo.
2. Se crea una sesión por factura y un enlace de un solo uso. El cliente ve sus datos y escribe la tarjeta en los campos de CyberSource.
3. Antes de autorizar, se vuelve a consultar el saldo. La sesión bloqueada impide dos intentos simultáneos y los resultados inciertos no permiten repetir el cargo.
4. Un pago confirmado queda en una cola persistente. Pay registra el importe original USD en esa misma factura de Storeganise, con método tarjeta y referencia CyberSource; el banco recibe el cargo HNL.
5. Pay puede completar el paso pendiente de la factura inicial ya pagada. Solo muestra la bodega habilitada después de comprobar que está ocupada por ese cliente y ese alquiler.
6. Storeganise notifica al portal fiscal mediante la conexión que administra el comercio. Pay no envía avisos directos al portal.

El enlace firmado permite abrir el carrusel sin volver a pedir la contraseña. Para reservas sin factura interna, el servidor consulta la vista previa del importe en Storeganise. Antes de cobrar, la reserva debe estar confirmada y disponer de un registro contable cobrable; Pay no omite firmas ni fuerza la ocupación. Seleccionar webhooks no instala la integración de facturación que entrega el enlace al navegador. La activación de esa integración y sus automatizaciones siguen pendientes de confirmar en la cuenta externa; ver [CONEXION_GTM_STOREGANISE.md](CONEXION_GTM_STOREGANISE.md). No se almacenan tarjetas para cargos recurrentes.

## Publicación

- [CONEXION_GTM_STOREGANISE.md](CONEXION_GTM_STOREGANISE.md): etiqueta de reemplazo, entrada desde GTM y condición pendiente del paso nativo de reserva.
- [DESPLIEGUE_GITHUB_VERCEL.md](DESPLIEGUE_GITHUB_VERCEL.md): variables, despliegue y tarea programada.
- [CONFIGURACION_STOREGANISE.md](CONFIGURACION_STOREGANISE.md): contrato de entrada, eventos, registro del pago y activación.
- [PASOS_PENDIENTES_STOREGANISE.md](PASOS_PENDIENTES_STOREGANISE.md): configuración externa que falta.
- [examples/storeganise-handoff.ts](examples/storeganise-handoff.ts): función para el servidor que dirige al cliente a Pay.
- [PRUEBAS_MANUALES_SANDBOX.md](PRUEBAS_MANUALES_SANDBOX.md): uso del formulario manual existente.
- [CONFIGURACION_BCH.md](CONFIGURACION_BCH.md): conversión USD a HNL.

Las variables privadas no se suben a GitHub. El cambio de código no modifica `.env.local` ni las variables guardadas en Vercel. Para pruebas, guardar la configuración sandbox indicada y redesplegar; para pagos reales se necesitan el entorno y las credenciales de producción.

Los informes RESULTADOS_* y PRUEBAS_* conservan evidencia de etapas anteriores y no certifican esta actualización.

