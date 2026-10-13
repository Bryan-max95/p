# Revisión del flujo CyberSource sandbox

Fecha: 26 de septiembre de 2026. Alcance: documentación oficial aplicable a Microform v2, Payer Authentication REST y Payments, contrastada con el código del proyecto. No se trata de una certificación de BAC ni de todos los productos de CyberSource.

## Corrección encontrada en nuestra autorización

La respuesta de 3DS y la solicitud de autorización financiera no usan exactamente los mismos campos. Había una diferencia real en nuestro código:

| Dato recibido de CyberSource | Antes, en Payments | Ahora, en Payments |
| --- | --- | --- |
| `specificationVersion` | Se enviaba con ese mismo nombre | `consumerAuthenticationInformation.paSpecificationVersion` |
| `eciRaw` | Se omitía | `consumerAuthenticationInformation.eciRaw` |
| `paresStatus` | Se guardaba en el resultado local, pero se omitía del pago | `consumerAuthenticationInformation.paresStatus` |

Los valores se toman de la respuesta autenticada del servidor de CyberSource. No se inventa un ECI ni se convierte una autenticación fallida en exitosa. Se conservan los criptogramas CAVV/UCAF y los identificadores devueltos por el proveedor. Este mapeo se utiliza tanto después del enrollment sin desafío como después de validar un desafío.

La [guía de autorización con Payer Authentication](https://developer.cybersource.com/docs/cybs/en-us/payments/developer/ctv/rest/payments/payments-processing-pa-process-intro/payments-processing-pa-eci.html) enumera los campos que deben trasladarse a una autorización separada. La [guía REST de Payer Authentication](https://developer.cybersource.com/docs/cybs/en-us/payer-authentication/developer/all/rest/payer-auth.html) especifica el cambio de nombre de la versión.

## Partes revisadas

| Etapa | Implementación revisada | Conclusión |
| --- | --- | --- |
| Captura de tarjeta | Número y CVV se introducen en iframes de Microform; el servidor recibe un token firmado | Se conserva. No se cambió el formulario ni el diseño. |
| Token para Payments | `tokenInformation.jti` | La documentación acepta JTI y JWT como alternativas; no había evidencia para reemplazarlo. |
| Inicio de 3DS | `POST /risk/v1/authentication-setups` | Se conserva el token transitorio y la referencia por intento. |
| Enrollment | `POST /risk/v1/authentications` con importe, moneda, datos de facturación, navegador y referencia de recolección | Se conserva. El resultado puede requerir desafío; eso por sí solo no es un error ni una aprobación de pago. |
| Validación del desafío | `POST /risk/v1/authentication-results` | Se conserva la comprobación del servidor antes de autorizar. Las pruebas de esta ejecución usan el caso Visa sin desafío. |
| Autorización | `POST https://apitest.cybersource.com/pts/v2/payments` | Se corrigió únicamente el traslado de los tres campos 3DS descritos arriba. |
| Venta | `processingInformation.capture: true` | Es la modalidad documentada para solicitar autorización y captura juntas. No garantiza que la autorización sea aprobada. |
| Firma REST | Digest y HMAC sobre la solicitud; `v-c-merchant-id` con el Organization ID existente | Se conserva. Quitar ese encabezado rompe la identificación de la cuenta. |
| Adquirente | No se envía `acquirerInformation` en el cuerpo del pago | No se agregó `merchantId`, `acquirerMerchantId` ni otro identificador inventado. |
| Resultados inciertos | Un 502 conserva el intento para consulta; no produce comprobante de pago ni reenvío automático | Se conserva. Un éxito de 3DS no sustituye una autorización financiera. |

Referencias oficiales adicionales:

- [Uso de tokens transitorios: JTI y JWT](https://developer.cybersource.com/docs/cybs/en-us/digital-accept-flex/developer/all/rest/digital-accept/microform-integ-v2/microform-integ-getting-started-v2/setting-up-client-side-v2/using-transient-token-v2.html).
- [Venta con autorización y captura](https://developer.cybersource.com/docs/cybs/en-us/payments/developer/ctv/rest/payments/payments-processing-basic-intro/payments-processing-basic-sale-intro.html).
- [Encabezados y firma REST](https://developer.cybersource.com/docs/cybs/en-us/platform/developer/all/rest/rest-getting-started/restgs-http-message-intro/restgs-http-message-conf-intro/restgs-http-const-elements.html).

## Verificación del cambio

Pasaron 19 pruebas automatizadas. Los nuevos casos comprueban el JSON final de autorización para Visa, Mastercard y American Express después de enrollment y de validación del desafío; también verifican que un 502 siga siendo un resultado incierto, que no se agreguen campos de adquirente y que el diagnóstico oculte tokens y criptogramas. Estas pruebas utilizan respuestas controladas, no son aprobaciones del procesador.

Las pruebas reales de esta revisión se documentan en [RESULTADOS_MONTOS_SANDBOX.md](RESULTADOS_MONTOS_SANDBOX.md). Utilizaron cuatro sesiones nuevas, Visa de ensayo y montos de 1, 2, 5 y 10 USD, con las credenciales existentes. Las cuatro completaron 3DS con PARes `Y`; las cuatro autorizaciones respondieron `HTTP_502 / SYSTEM_ERROR`, y sus consultas financieras confirmaron `ESYSTEM / 150` con referencia a `merchant_id`. Hubo un intento por sesión, cero aprobaciones y cero avisos al Portal. No se utilizaron clientes fiscales reales. La comprobación de tipos y ESLint también pasaron.

## Qué permite concluir el error

`502 / SYSTEM_ERROR / 150` no identifica por sí solo un campo incorrecto de nuestro JSON. Se necesita el detalle de la aplicación financiera. El texto específico observado en las pruebas anteriores era `Payment processor error: This field is invalid or missing: merchant_id`.

Corregir el mapeo 3DS no eliminó el error: las cuatro solicitudes nuevas volvieron a recibirlo. Corresponde entregar estos nuevos Request ID a soporte CyberSource/BAC y solicitar que identifique el campo o la configuración exactos en la etapa de autorización. El perfil del procesador es una hipótesis por comprobar; no se ha inspeccionado desde este proyecto. No hay respaldo para inventar un MID ni para quitar el Organization ID existente del encabezado REST.

La [guía oficial de errores y comportamiento de sandbox](https://support.visaacceptance.com/knowledgebase/article/KA-07420/en-us) reconoce fallos generales y transitorios, distingue errores de configuración y recomienda soporte cuando los intentos fallan consistentemente. También advierte sobre duplicados al reenviar sin comprobar el estado. La prueba compara solicitudes nuevas; no reenvía un pago cuyo resultado es incierto.

## Archivos modificados

- `lib/cybersource/gateway.ts`: mapeo de datos 3DS hacia autorización.
- `lib/cybersource/types.ts`: nombres y tipos del comprobante de autenticación que recibe Payments.
- `lib/cybersource/authorization-audit.ts`: campos no sensibles visibles en el diagnóstico.
- `tests/pay-authorization.test.ts`: regresión del mapeo para las tres marcas y ambos caminos 3DS.

No se cambiaron credenciales, cuenta, esquema de base de datos, encabezado de comercio, pantallas, idiomas ni carrusel. No se inició ni se detuvo el servidor de desarrollo del usuario.
