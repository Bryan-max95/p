# Preparación del despliegue de Pay

Actualizado el 14 de octubre de 2026. Esta actualización no se probó, compiló ni ejecutó por indicación del comercio.

El flujo nuevo permite abrir el carrusel desde una reserva sin pedir una factura previa: [CONEXION_GTM_STOREGANISE.md](CONEXION_GTM_STOREGANISE.md). La etiqueta navega a la API de Pay. Pay pide iniciar sesión con la cuenta de Storeganise, verifica el propietario y obtiene el total en el servidor.

Falta confirmar fuera del código:

1. Que Vercel desplegó este commit y tiene PAY_PUBLIC_URL=https://www.payroatanselfstorage.com, PostgreSQL y todas las variables privadas de [.env.example](.env.example).
2. Que STOREGANISE_PAY_ENABLED=true y los entornos son compatibles: sandbox con Storeganise .dev y clientes autorizados; producción con Storeganise .com y acceso BAC válido. No se cambió el entorno bancario en esta actualización.
3. Que se publicó una sola etiqueta de pago, con el contenido completo de [examples/gtm-storeganise-pago.html](examples/gtm-storeganise-pago.html), y se recargó el portal.
4. Que Storeganise permite iniciar sesión por su API de cliente y consultar esa reserva con invoicePreview. Si exige otro mecanismo de acceso, debe integrarse el mecanismo admitido; no se interpreta un ID o correo como autenticación.
5. Que Storeganise puede confirmar la reserva, asignar la unidad y emitir su factura interna al enviarla. Pay abre el carrusel antes de ese paso, pero no cobra si Storeganise no tiene dónde registrar el pago. La factura fiscal del portal sigue siendo posterior al pago.
6. Que la API administrativa permite registrar pagos, el método card existe y las automatizaciones de ocupación avanzan al pagar sin omitir requisitos de contrato o identidad.
7. Que el secreto de firma de los webhooks coincide, las entregas llegan a /api/storeganise/billing y el trabajador de conciliación está programado con CRON_SECRET. El respaldo diario de Vercel no sustituye una frecuencia mayor cuando no hay navegador abierto.
8. Cuando el comercio autorice pruebas, validar el recorrido con la cuenta externa. No se declara validada la activación automática de la bodega únicamente por terminar el código.

No se crean tarjetas guardadas ficticias: billing.list no devuelve fuentes reutilizables y billing.charge no realiza cobros recurrentes. El pago por reserva usa la API nueva de Pay y el cliente introduce la tarjeta en el carrusel.
