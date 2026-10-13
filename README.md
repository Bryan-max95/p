# Pay Roatan Self Storage

Carrusel de pago con tarjeta mediante CyberSource Microform y 3D Secure. Muestra el saldo en USD, calcula el cargo en HNL con la tasa BCH y guarda cliente, factura, bodega, cotización e intento en PostgreSQL.

Actualización del código: 13 de octubre de 2026. Esta actualización se realizó sin ejecutar pruebas, compilación, servidor ni operaciones bancarias. Los resultados históricos de sandbox no validan la integración nueva.

## Integración incorporada

1. Un servidor autenticado de Storeganise envía a Pay el identificador del usuario y de la factura o entrada. Pay consulta la Admin API y comprueba a quién pertenece cada registro; el navegador no fija el saldo.
2. Se crea una sesión por factura y un enlace de un solo uso. El cliente ve sus datos y escribe la tarjeta en los campos de CyberSource.
3. Antes de autorizar, se vuelve a consultar el saldo. La sesión bloqueada impide dos intentos simultáneos y los resultados inciertos no permiten repetir el cargo.
4. Un pago confirmado queda en una cola persistente. Pay registra el importe original USD en esa misma factura de Storeganise, con método tarjeta y referencia CyberSource; el banco recibe el cargo HNL.
5. Pay puede completar el paso pendiente de la factura inicial ya pagada. Solo muestra la bodega habilitada después de comprobar que está ocupada por ese cliente y ese alquiler.
6. Storeganise notifica al portal fiscal mediante la conexión que administra el comercio. Pay no envía avisos directos al portal.

La entrada implementada requiere una factura creada y emitida. El checkout nativo para agregar un método de pago puede ocurrir antes de ese paso: seleccionar sus webhooks no instala automáticamente la redirección. Se debe conectar el handoff del servidor descrito en [CONFIGURACION_STOREGANISE.md](CONFIGURACION_STOREGANISE.md). No se almacenan tarjetas para cargos recurrentes.

## Publicación

- [DESPLIEGUE_GITHUB_VERCEL.md](DESPLIEGUE_GITHUB_VERCEL.md): variables, despliegue y tarea programada.
- [CONFIGURACION_STOREGANISE.md](CONFIGURACION_STOREGANISE.md): contrato de entrada, eventos, registro del pago y activación.
- [PASOS_PENDIENTES_STOREGANISE.md](PASOS_PENDIENTES_STOREGANISE.md): configuración externa que falta.
- [examples/storeganise-handoff.ts](examples/storeganise-handoff.ts): función para el servidor que dirige al cliente a Pay.
- [PRUEBAS_MANUALES_SANDBOX.md](PRUEBAS_MANUALES_SANDBOX.md): uso del formulario manual existente.
- [CONFIGURACION_BCH.md](CONFIGURACION_BCH.md): conversión USD a HNL.

La configuración local se conserva en sandbox. Las variables privadas no se suben a GitHub. Cambiar a producción requiere configurar el entorno y el acceso de BAC, además de Storeganise; publicar el repositorio no valida ninguna de esas conexiones.

Los informes RESULTADOS_* y PRUEBAS_* conservan evidencia de etapas anteriores y no certifican esta actualización.

