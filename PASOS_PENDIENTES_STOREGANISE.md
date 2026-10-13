# Configuración que falta fuera del código de Pay

Actualizado el 13 de octubre de 2026.

El código incorpora la recepción firmada, identificación de cliente/factura/bodega, conversión BCH, registro del pago y seguimiento de la entrada. Esta actualización no se probó ni se compiló por indicación del comercio.

Para usar el recorrido completo aún hace falta:

1. Publicar Pay con las variables privadas de [.env.example](.env.example), PostgreSQL y el dominio correcto.
2. Configurar en Storeganise una redirección después de crear y emitir la factura. Su servidor envía userId e invoiceId firmados a /api/storeganise/checkout y abre la URL recibida. El ejemplo está en [examples/storeganise-handoff.ts](examples/storeganise-handoff.ts). Solo seleccionar billing.checkout no conecta este recorrido.
3. Configurar el secreto real y los eventos de seguimiento de [CONFIGURACION_STOREGANISE.md](CONFIGURACION_STOREGANISE.md).
4. Confirmar permisos API para registrar pagos, el código del método tarjeta y las automatizaciones de entrada.
5. Elegir entornos compatibles: sandbox con Storeganise dev; producción con Storeganise real y acceso BAC válido. La configuración local permanece en sandbox.
6. Programar la conciliación con CRON_SECRET. El archivo Vercel incluye un respaldo diario; para atención continua sin navegador debe configurarse una frecuencia mayor según el plan o un programador externo.
7. Cuando el comercio decida ejecutar sus pruebas, validar el recorrido completo. El código incorporado no equivale a una conexión externa comprobada.

Mensaje para Storeganise si el portal nativo no permite instalar la redirección:

> Necesitamos un handoff de pago externo después de que la orden de entrada tenga una factura emitida con saldo. Nuestro servidor Pay recibe una petición firmada con userId e invoiceId, devuelve una URL de checkout y registra el pago por la Admin API tras confirmarlo con CyberSource. No almacenamos tarjetas ni realizamos cargos recurrentes. Necesitamos colocar esta redirección en ese punto del recorrido y que la entrada continúe al quedar pagada la factura. Por favor indiquen la personalización o add-on compatible con nuestra cuenta.

La generación fiscal en el portal se mantiene bajo la integración que ya administra el comercio.

