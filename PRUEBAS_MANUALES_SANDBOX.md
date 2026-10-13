# Pruebas manuales en sandbox

Configuración local actualizada el 13 de octubre de 2026 a petición del comercio. No se ejecutaron pagos ni consultas al banco al cambiar el entorno.

```dotenv
CYBERSOURCE_ENVIRONMENT=sandbox
```

La API seleccionada es `https://apitest.cybersource.com`. Microform y Cardinal/3DS también seleccionan sus endpoints de pruebas mediante la misma variable. Las tres credenciales existentes se conservan. Las demos automáticas y las entregas directas al Portal permanecen desactivadas.

## Escribir todos los datos desde el carrusel

La configuración local habilita `PAY_SANDBOX_MANUAL_ENABLED=true`, incluye `manual-sandbox-customer` en `STOREGANISE_TEST_CUSTOMER_IDS` y usa `PAY_PUBLIC_URL=http://localhost:3000`.

1. Inicia o reinicia `pnpm dev` y abre `http://localhost:3000`.
2. Escribe el nombre, la bodega y el precio USD en los tres campos originales.
3. Pulsa **Continuar a Datos de Tarjeta**. El servidor prepara una sesión sandbox y guarda la conversión BCH. No se cobra en este paso.
4. Escribe manualmente el número de tarjeta de prueba, nombre del titular, vencimiento y CVV. Número y CVV se capturan en los campos seguros de CyberSource, sin pasar por el servidor de Pay.
5. Pulsa **Pagar Ahora** cuando quieras ejecutar la prueba. El cargo enviado a sandbox es en HNL. Conserva el identificador del comprobante para revisar el resultado posteriormente.

La sesión de prueba utiliza una dirección y un correo ficticios de facturación definidos en el servidor; no se agregan campos al carrusel ni se envían esos datos como facturación de un pago de producción. El importe escrito en el navegador solo se acepta mediante este modo explícito de sandbox.

En producción, el cliente también escribe manualmente todos los datos de tarjeta. La sesión de cobro de producción debe provenir de un enlace válido con el monto y la facturación definidos en el servidor. `PAY_SANDBOX_MANUAL_ENABLED` nunca habilita importes públicos en producción.

La entrada manual sigue la integración [Microform de CyberSource](https://developer.cybersource.com/docs/cybs/en-us/digital-accept-flex/developer/all/rest/digital-accept/microform-integ-v2/microform-integ-getting-started-v2/setting-up-client-side-v2.html).

## Alternativa: crear un enlace desde la consola

1. `PAY_PUBLIC_URL` debe coincidir exactamente con el origen donde abras el carrusel. La configuración local usa `http://localhost:3000`.
2. Copia `examples/manual-checkout.json` a `.private/cobro.json`. Define cliente de prueba, bodega, una referencia nueva y el importe en USD. El `customerId` debe estar incluido en `STOREGANISE_TEST_CUSTOMER_IDS`, la lista privada de clientes habilitados para sandbox. Incluye los datos de facturación del escenario de prueba.
3. Cuando estés listo para pagar, crea una sesión nueva:

   ```powershell
   pnpm pay:manual --file=.private/cobro.json
   ```

   Este comando guarda la sesión y consulta BCH si necesita una cotización vigente; no envía una tarjeta ni inicia un pago. La salida indica el archivo privado `.private/manual-<id>.json`, que contiene `launchUrl`.
4. Abre ese `launchUrl` dentro de los 30 minutos de vigencia. Introduce la tarjeta de prueba en el carrusel y confirma el pago manualmente. No reutilices un enlace de producción o vencido; cada sesión conserva el entorno con el que se creó.
5. Conserva el ID de la sesión o de la transacción para revisar después el resultado guardado. No compartas número de tarjeta, CVV ni claves.

El precio se muestra en USD. El servidor guarda la tasa BCH y envía el importe convertido a CyberSource con moneda HNL. El importe de la sesión no puede cambiarse desde los campos públicos del navegador.

Abrir la portada por sí solo no crea una sesión. Con el modo manual sandbox habilitado, pulsar **Continuar** después de completar los tres campos sí la prepara. Si ese modo está deshabilitado o el entorno es producción, se requiere el enlace del servidor.

## Si pruebas en Vercel

Configura `CYBERSOURCE_ENVIRONMENT=sandbox`, `PAY_SANDBOX_MANUAL_ENABLED=true` e incluye `manual-sandbox-customer` en `STOREGANISE_TEST_CUSTOMER_IDS` del entorno privado de Vercel donde probarás. Usa `PAY_PUBLIC_URL=https://payroatanselfstorage.com` o el origen HTTPS exacto del despliegue y vuelve a desplegar. El archivo `.env.local` está excluido de GitHub y no cambia automáticamente la configuración de Vercel. Para volver al cobro real, configura el entorno CyberSource en producción y desactiva `PAY_SANDBOX_MANUAL_ENABLED`; la entrada de tarjeta continúa siendo manual.

Estas pruebas manuales no registran un pago en Storeganise ni activan una bodega. Esa integración sigue pendiente según [PASOS_PENDIENTES_STOREGANISE.md](PASOS_PENDIENTES_STOREGANISE.md).

## Verificación de esta modificación

- 44 pruebas locales aprobadas con servicios simulados, incluyendo el bloqueo de importes públicos en producción, conversión USD99 → HNL con tasa de prueba, sesiones simultáneas y reintentos sin duplicar la preparación.
- Entrada manual de número, titular, vencimiento y CVV comprobada en navegador a 390 y 1280 píxeles. Se comprobaron una sesión sandbox creada desde los tres campos y una sesión de producción simulada abierta mediante enlace.
- Compilación de producción y ESLint de los archivos modificados completados. La compilación conserva las advertencias de caché de webpack sin errores.
- La biblioteca de tarjeta, las respuestas de la API y la tasa usadas en la revisión de navegador fueron simuladas. No se consultó CyberSource ni se tokenizó o cobró ninguna tarjeta. Esta verificación no acredita disponibilidad bancaria.

## Corrección de reintentos del 13 de octubre

Se reprodujo un fallo real: la primera preparación respondía HTTP 200, pero repetirla sin la cookie de la primera respuesta devolvía HTTP 503. El intercambio del enlace era de un solo uso y dejaba bloqueada la prueba si la respuesta o su cookie se perdían.

La preparación manual sandbox ahora recupera el mismo acceso de forma idempotente y reintenta una vez un fallo temporal de red. Conserva cliente, monto, tasa, vencimiento y estado financiero; no crea otro intento ni vuelve a abrir un pago en curso o completado. El intercambio de enlaces de producción no cambia.

Verificaciones posteriores a la corrección:

- 46 pruebas locales aprobadas, incluidas recuperación sin cookie, llamadas simultáneas, conservación del estado del pago y exclusión de sesiones de producción y Storeganise.
- Tres solicitudes reales de preparación sin cookie devolvieron HTTP 200 para la misma sesión sandbox, sin iniciar un pago.
- Apertura real en `http://localhost:3000`: preparación HTTP 200, contexto Microform sandbox HTTP 200 y campos reales de número y CVV visibles y editables. Se dejaron vacíos; no se tokenizó ninguna tarjeta ni se pulsó **Pagar Ahora**. La sesión de esta comprobación tiene cero intentos de pago.
- Evidencia visual privada: `.private/manual-live-fields.png`. Esta apertura verifica la preparación y la carga de campos; no acredita la aprobación de un pago.

## Corrección de `purchaser_code` y capturas parciales — 13 de octubre

La consulta de los tres intentos manuales existentes confirmó autenticación y autorización aprobadas, seguidas de captura fallida con `The field is invalid: purchaser_code` (código 102). El modo manual enviaba `manual-sandbox-customer` (23 caracteres) como `buyerInformation.merchantCustomerId`; las pruebas anteriores enviaban `demo-customer-a` (15). El campo también se utiliza como `purchaser_code` y su longitud general documentada es 15.

- La referencia enviada a CyberSource ahora respeta 15 caracteres, tanto en 3DS como en el pago. Los identificadores largos se convierten en una referencia estable. El identificador original, el cliente, la bodega y la referencia única del intento se conservan en la sesión; el identificador abreviado no se usa para asociar pagos a clientes.
- Se mantienen el formulario y la tarjeta manuales, el precio visible en USD y el cobro en HNL según la cotización guardada del BCH. Se mantiene `capture: true`.
- Un error financiero con ID de transacción queda pendiente de verificación. La consulta del resultado por GET distingue autorización de captura y no vuelve a autorizar ni capturar automáticamente.
- Al consultar una sesión antigua afectada, se revisa su último intento. Una autorización con captura fallida conserva el bloqueo de pago y no genera comprobante de pago completado.
- La pantalla distingue rechazo, datos inválidos y autorización aprobada con cobro incompleto. Solo expone códigos de mensaje controlados por la aplicación.

Verificación de esta corrección:

- 35 pruebas locales con servicios simulados aprobadas; TypeScript y ESLint de los archivos modificados sin errores.
- Cuatro casos de navegador (escritorio y móvil, con respuestas simuladas de sandbox y producción) comprobaron entrada manual de tarjeta, mensaje de autorización con captura fallida y botón de pago deshabilitado para esa operación. Cero solicitudes al banco y cero solicitudes de pago. Evidencia privada: `.private/manual-ui/results.json` y `partial-*.png`.
- Consulta de recuperación de estados antiguos validada con `EXPLAIN` en una transacción PostgreSQL de solo lectura, sin ejecutar las actualizaciones.

No se enviaron nuevos pagos ni se inició o reinició el servidor. La aprobación de una nueva operación en CyberSource queda pendiente de la prueba manual del comercio.

Para una nueva prueba sandbox, abrir el dominio de Pay directamente en una pestaña nueva y completar el formulario. La sesión anterior se conserva para consultar su resultado; no debe reutilizarse para repetir la autorización que ya fue aprobada.

Referencia: [especificación de `merchantCustomerId`](https://developer.cybersource.com/docs/cybs/en-us/api-fields/reference/all/so/api-fields/buyer-info-merchant-customer-id.html).
