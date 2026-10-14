# Solicitud de configuración a Storeganise

Asunto: Habilitar acceso autenticado de reservas a nuestro checkout Pay

Hola, equipo de Storeganise:

Necesitamos conectar el portal de clientes de Roatan Self Storage con nuestro checkout de pago puntual en https://www.payroatanselfstorage.com. El cliente ya inicia sesión en Storeganise y debe llegar a Pay con su reserva identificada, sin volver a escribir sus credenciales.

Nuestro servidor recibe los eventos firmados con `sg-signature` en:

https://www.payroatanselfstorage.com/api/storeganise/billing

El manejador `billing.checkout` espera `data.userId`, la reserva mediante `data.orderId`/`data.jobId` o `returnUrl` con `orderId`, y `data.siteId` cuando corresponda. Devuelve HTML que redirige a un enlace privado de Pay, de un solo uso. También tenemos una entrada JSON firmada `pay.checkout` en `/api/storeganise/checkout` que devuelve `{ "url": "..." }`.

Solicitamos:

1. Instalar/configurar la integración de facturación personalizada para que `/api/v1/billing/custom?siteId=...&returnUrl=...`, llamado con la sesión activa del cliente, entregue el checkout de Pay. Este endpoint mostró HTTP 404 anteriormente; configurar solamente los webhooks no resolvió la entrada.
2. Confirmar el contrato de respuesta que requiere la integración: HTML alojado o URL JSON, y cómo transporta la reserva concreta. El endpoint de Pay no acepta un identificador de usuario como prueba de identidad desde el navegador.
3. Habilitar el recorrido de pago externo puntual: confirmación de la reserva y requisitos contractuales, creación de su registro contable, cobro en Pay y registro del pago externo por API. El botón nativo de añadir tarjeta no debe quedarse esperando una tarjeta guardada, porque esta integración no guarda métodos reutilizables ni realiza cargos recurrentes por `billing.charge`.
4. Confirmar que nuestra clave pueda consultar la vista previa `POST /api/v1/admin/jobs/{id}/operations/previewInvoice`, usuarios, reservas, unidades y facturas; registrar pagos externos; y completar el paso de factura inicial pagada cuando esté habilitado.
5. Configurar las automatizaciones del centro para que, después de registrar el pago y cumplir los requisitos de la reserva, la bodega quede ocupada por el mismo cliente. Pay comprueba ese estado antes de mostrarla como habilitada.

Los precios de la reserva se manejan en USD y el cargo bancario en HNL con conversión BCH. El pago externo se registra en la moneda de Storeganise. La factura fiscal se genera en nuestro portal separado, mediante su conexión existente con Storeganise.

No incluimos claves ni secretos en este mensaje. Agradecemos confirmar la configuración y facilitar el contrato de la integración para poder validar el recorrido completo cuando autoricemos las pruebas.

Saludos,
Roatan Self Storage
