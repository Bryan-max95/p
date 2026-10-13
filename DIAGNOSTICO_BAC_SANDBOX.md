# Solicitud de revisión de autorización sandbox BAC / CyberSource

Última actualización: 28 de septiembre de 2026.

Comercio CyberSource: `test_bac_hn_bodegsegurasroatan`.
Endpoint: `POST https://apitest.cybersource.com/pts/v2/payments`.
Procesador informado por CyberSource: `vdcbaccredhn`.

## Nuevas pruebas: 28 de septiembre de 2026, desde las 06:05 UTC

Se repitieron cuatro pagos Visa de ensayo con las mismas credenciales sandbox, sin cambios al código de autorización. Todos completaron Payer Authentication con PARes `Y`; ninguno tuvo autorización financiera aprobada. Las cuatro consultas de detalle confirmaron `ics_auth / ESYSTEM / 150`, con referencia al campo `merchant_id` en el mensaje del procesador.

| USD | Request ID financiero |
| ---: | --- |
| 1.00 | `7905755279036290004807` |
| 2.00 | `7905755382506590404806` |
| 5.00 | `7905755505476613004806` |
| 10.00 | `7905755635756637904806` |

Cada sesión tiene un único intento y cero avisos al Portal. No se agregaron identificadores de adquirente. Se solicita identificar qué campo o configuración del perfil sandbox origina el error; no se ha confirmado todavía el ajuste exacto que corresponde. Referencias y resultados completos en [RESULTADOS_MONTOS_SANDBOX.md](RESULTADOS_MONTOS_SANDBOX.md).

## Prueba controlada anterior: 26 de septiembre, 20:52:46 UTC

Por solicitud del usuario se ejecutó una sola prueba nueva, sin modificar Microform, 3DS, v-c-merchant-id ni el JSON de autorización. El código y el cuerpo efectivamente enviado confirman que acquirerInformation.merchantId y acquirerInformation.acquirerMerchantId están ausentes; no se agregaron esos campos ni valores inventados.

Visa de ensayo por 1.00 USD. Request ID financiero: `7904559671966651104805`. Referencia: `RSS-42787d02-7914-4203-9701-1e193e1ff8a3-1`. Setup exitoso: `7904559598786645104805`. Autenticación exitosa: `7904559666776869404806`, PARes `Y`.

CyberSource autenticó y registró la solicitud; el error aparece después de completar 3DS, en la autorización del procesador: HTTP 502, `SERVER_ERROR / SYSTEM_ERROR`, `ics_auth / ESYSTEM / 150 / -1`, `merchant_id` inválido o ausente. Se confirmó mediante una consulta de solo lectura; no se repitió el pago. Hubo un intento y cero avisos al Portal.

Solicitamos a BAC confirmar si el Organization ID sandbox `test_bac_hn_bodegsegurasroatan` tiene correctamente configurado el Merchant ID del adquirente/procesador para **Card Payments Authorization**. No agregaremos campos de adquirente sin documentación aplicable o confirmación de BAC. El reporte de la solicitud y el caso completo están en [DIAGNOSTICO_AUTORIZACION_CONTROLADA.md](DIAGNOSTICO_AUTORIZACION_CONTROLADA.md).

## Prueba anterior: 26 de septiembre, 20:39:56 UTC

Una única autorización nueva de Visa por 1.00 USD, Request ID `7904551965026170204806`, referencia `RSS-33cc440c-9910-4787-8ead-8ffecc12f2d0-1`. Microform, setup y autenticación completados; PARes `Y`. Se actualizó solo el encabezado y firma de autorización a `v-c-date`. El registro de los bytes enviados confirmó MID correcto, digest/firma coherentes y ausencia de campos de adquirente vacíos.

El resultado sigue siendo HTTP 502, `SERVER_ERROR / SYSTEM_ERROR`; Transaction Search confirmó `ics_auth / ESYSTEM / 150 / -1`, campo `merchant_id` inválido o ausente. Se detuvieron las pruebas; no se envió otra autorización. Caso listo para BAC, encabezados seguros y JSON redactado en [DIAGNOSTICO_AUTORIZACION_CONTROLADA.md](DIAGNOSTICO_AUTORIZACION_CONTROLADA.md). No se ha enviado el caso a terceros.

## Prueba aislada

- Request ID: `7904409386496322304805`.
- Referencia: `RSS-001feed5-2be8-420a-87d8-9e05ca4cd9fd-1`.
- Monto: 1.00 USD, tarjeta Visa general de sandbox terminada en 1111.
- `processingInformation.capture: false`.
- Sin `actionList`, sin autenticación 3D Secure combinada y sin solicitud de captura.
- Tarjeta tokenizada mediante Flex Microform; `tokenInformation.jti` verificado en el servidor.
- Respuesta inicial: HTTP 502 / SYSTEM_ERROR.
- Consulta posterior: aplicación `ics_auth`, `rFlag: ESYSTEM`, `reasonCode: 150`, `rCode: -1`.
- Mensaje del proveedor: campo `merchant_id` inválido o ausente.

## Prueba con autenticación previa

Request ID financiero `7904410075776385504805`, referencia `RSS-82448f5a-869e-41ff-abb1-f1a0d5c47884-1`, 1.00 USD. Se completó setup y autenticación del titular antes de solicitar el pago. La autorización repite el mismo error sobre `merchant_id`; la captura no se ejecutó.

## Revisión solicitada

### Comparación adicional de marca e importe

El 26 de septiembre, desde las 17:38 UTC, se ejecutaron 12 sesiones independientes: Visa, Mastercard y American Express, cada una por 1, 2, 5 y 10 USD. Todas completaron autenticación con PARes `Y`. Las 12 autorizaciones fallaron con HTTP 502 y Transaction Search confirmó `ics_auth / ESYSTEM / 150`, campo `merchant_id` inválido o ausente. El fallo se reprodujo en todos los importes y marcas probados.

Ejemplos nuevos: Visa 10 USD `7904443498986712204805`; Mastercard 10 USD `7904443946186945804806`; American Express 10 USD `7904444469606772304807`. La matriz completa, incluyendo referencias e IDs de autenticación, está en [RESULTADOS_MONTOS_SANDBOX.md](RESULTADOS_MONTOS_SANDBOX.md).

También se completó un desafío interactivo del emisor sandbox y se validó el resultado antes del pago: Request ID financiero `7904426437706091004807`, 1.00 USD, referencia `RSS-462c7fe4-a9fe-46f0-a2e2-58669c5dcfcb-1`. La autorización volvió a responder HTTP 502 / SYSTEM_ERROR; Transaction Search confirmó `ics_auth / ESYSTEM / 150` con el mismo error de `merchant_id`.

Confirmar los datos del comercio y su habilitación para autorización con `vdcbaccredhn` en sandbox. Identificar dónde se espera el `merchant_id` que el procesador informa inválido o ausente. Si este perfil requiere un campo adicional en la solicitud REST, proporcionar el nombre exacto, el valor de ensayo asignado y un ejemplo oficial para BAC Honduras.

No se ha confirmado ningún pago aprobado. Los intentos inciertos permanecen bloqueados; no se reenvían automáticamente. Las pruebas usan clientes y facturas ficticios, sin avisos al Portal, CAI ni activación de bodegas.

Este documento no contiene contraseñas, Shared Secret, token de tarjeta ni credenciales de Neon.
