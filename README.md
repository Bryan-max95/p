# Pay Roatan Self Storage

Carrusel de pago con tarjeta mediante CyberSource Microform y 3D Secure. Los precios se ingresan en USD y los pagos nuevos se envían en lempiras (HNL), usando la tasa BCH fijada en cada sesión. Guarda cliente, factura, bodega, cotización e intento en PostgreSQL.

Actualización del código: 2 de noviembre de 2026. La API bancaria admite únicamente producción. La entrada directa a Pay permite crear un pago manual con precio en USD, nombre y referencia opcional; antes de pagar muestra el cobro convertido a HNL. Storeganise conserva su acceso autenticado con el saldo verificado por el servidor. Ver [pagos manuales, moneda y despliegue](PAGOS_MANUALES_USD.md). La documentación de sandbox anterior se conserva como antecedente y no habilita ese entorno.

Las pruebas del cambio usan proveedores y base de datos simulados, sin transacciones bancarias ni escrituras en cuentas externas. Verifican el envío en HNL y la conversión; no certifican la aceptación bancaria de las credenciales de producción.

## Integración incorporada

Flujo de pagos reales, cuando CyberSource está en producción:

1. Un servidor autenticado de Storeganise envía a Pay el identificador del usuario y de la factura o entrada. Pay consulta la Admin API y comprueba a quién pertenece cada registro; el navegador no fija el saldo.
2. Se crea una sesión por factura y un enlace de un solo uso. El cliente ve sus datos y escribe la tarjeta en los campos de CyberSource.
3. Antes de autorizar, se vuelve a consultar el saldo. La sesión bloqueada impide dos intentos simultáneos y los resultados inciertos no permiten repetir el cargo.
4. Un pago confirmado queda en una cola persistente. Pay registra el importe original USD en esa misma factura de Storeganise, con método tarjeta y referencia CyberSource; el banco recibe el cargo HNL.
5. Pay puede completar el paso pendiente de la factura inicial ya pagada. Solo muestra la bodega habilitada después de comprobar que está ocupada por ese cliente y ese alquiler.
6. Storeganise notifica al portal fiscal mediante la conexión que administra el comercio. Pay no envía avisos directos al portal.

El enlace firmado permite abrir el carrusel sin volver a pedir la contraseña. Para reservas sin factura interna, el servidor consulta la vista previa del importe en Storeganise. En producción bancaria se conserva la exigencia de registro interno confirmado antes del cobro. Con sandbox y activación explícita, después de aprobar se confirma la reserva y se vincula su factura interna antes de registrar el pago. Pay completa los pasos conocidos de pago y ocupación y verifica la asignación; no inventa firmas ni omite pasos desconocidos. No se almacenan tarjetas para cargos recurrentes.

## Publicación

- [CONEXION_GTM_STOREGANISE.md](CONEXION_GTM_STOREGANISE.md): etiqueta de reemplazo, entrada desde GTM y condición pendiente del paso nativo de reserva.
- [DESPLIEGUE_GITHUB_VERCEL.md](DESPLIEGUE_GITHUB_VERCEL.md): variables, despliegue y tarea programada.
- [CONFIGURACION_STOREGANISE.md](CONFIGURACION_STOREGANISE.md): contrato de entrada, eventos, registro del pago y activación.
- [PASOS_PENDIENTES_STOREGANISE.md](PASOS_PENDIENTES_STOREGANISE.md): configuración externa que falta.
- [examples/storeganise-handoff.ts](examples/storeganise-handoff.ts): función para el servidor que dirige al cliente a Pay.
- [PRUEBAS_MANUALES_SANDBOX.md](PRUEBAS_MANUALES_SANDBOX.md): uso del formulario manual existente.
- [CONFIGURACION_BCH.md](CONFIGURACION_BCH.md): conversión USD a HNL.

Las variables privadas no se suben a GitHub. El cambio de código no modifica `.env.local` ni las variables guardadas en Vercel. El flujo publicado requiere el entorno y las credenciales de producción; las pruebas de código usan proveedores simulados.

Los informes RESULTADOS_* y PRUEBAS_* conservan evidencia de etapas anteriores y no certifican esta actualización.

