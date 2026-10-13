# Diagnóstico controlado de autorización BAC / CyberSource

Fecha UTC: 2026-09-26T20:52:08.654Z. Una sola prueba nueva de Visa por 1.00 USD, sin reenvíos.

| Dato | Resultado |
| --- | --- |
| Ambiente | SANDBOX |
| Endpoint | https://apitest.cybersource.com/pts/v2/payments |
| MID configurado | test_bac_hn_bodegsegurasroatan |
| v-c-merchant-id enviado | test_bac_hn_bodegsegurasroatan |
| Key ID (identificador) | [CYBERSOURCE_KEY_ID OCULTO] |
| Shared Secret | LOADED |
| Encabezado de fecha | v-c-date |
| Digest corresponde al JSON enviado | true |
| Firma corresponde a los headers enviados | true |
| MID enviado coincide con el configurado | true |
| acquirerInformation enviado | false |
| acquirerInformation.merchantId enviado | NO: campo ausente |
| acquirerInformation.acquirerMerchantId enviado | NO: campo ausente |
| Campos adquirente vacíos/null | 0 |
| Microform | OK |
| Payer Authentication Setup | SUCCESS |
| Payer Authentication Enrollment | AUTHENTICATION_SUCCESSFUL |
| PARes | Y |
| Autorización (aplicación ics_auth) | FAILED / ESYSTEM / 150 / replyCode -1 |
| Captura (aplicación ics_bill) | Sin resultado de ejecución; autorización fallida |
| HTTP | 502 |
| CyberSource status | SERVER_ERROR |
| Reason | SYSTEM_ERROR |
| Respuesta del procesador | Payment processor error: This field is invalid or missing: merchant_id |
| Request ID financiero | 7904559671966651104805 |
| Referencia de comercio | RSS-42787d02-7914-4203-9701-1e193e1ff8a3-1 |
| Request ID Setup | 7904559598786645104805 |
| Request ID autenticación | 7904559666776869404806 |
| Intentos guardados | 1 |
| Avisos al Portal | 0 |

## Confirmación de la solicitud, sin cambios en el flujo

En esta revisión no se modificaron Microform, 3DS, el encabezado v-c-merchant-id ni el JSON de autorización. Se mantuvo la implementación existente. El ajuste a v-c-date corresponde a la revisión anterior, no a esta prueba.

El código y el JSON efectivamente enviado a POST /pts/v2/payments confirman que NO se envían acquirerInformation.merchantId ni acquirerInformation.acquirerMerchantId. Tampoco se envía el objeto acquirerInformation. No se agregaron identificadores ni se sustituyeron por el Organization ID.

El único identificador de comercio enviado como v-c-merchant-id sigue siendo test_bac_hn_bodegsegurasroatan. La firma y el digest se verificaron con el cuerpo y los encabezados de esta solicitud. El registro oculta los tokens, las pruebas criptográficas 3DS y los datos personales.

Las credenciales se cargan juntas desde la fila cifrada de Neon para sandbox. El identificador configurado coincide con el facilitado por el usuario. Eso no certifica por sí solo la cuenta emisora de la llave: la asociación debe confirmarse en Key Management del Business Center. Los resultados de setup/enrollment muestran si esas llamadas fueron aceptadas.

## Resultado y siguiente paso

CyberSource recibió, autenticó y registró la solicitud REST, asignándole Request ID financiero 7904559671966651104805. Antes de solicitar la autorización financiera, Payer Authentication Setup y Payer Authentication Enrollment terminaron correctamente, con AUTHENTICATION_SUCCESSFUL y PARes Y.

Después, durante Card Payments Authorization, la respuesta del procesador informó que merchant_id falta o es inválido: HTTP 502, SERVER_ERROR / SYSTEM_ERROR; aplicación ics_auth, ESYSTEM, reasonCode 150, replyCode -1. La aceptación de las credenciales REST y el éxito de 3DS no equivalen a una autorización financiera aprobada.

No hay un merchantId ni un acquirerMerchantId vacío en el JSON de Pay. No se agregarán esos campos sin documentación aplicable o confirmación de BAC. Se detuvieron las pruebas financieras después de este único intento.

La primera consulta inmediata a Transaction Search no obtuvo el detalle. Una segunda consulta de solo lectura al mismo Request ID nuevo confirmó el error merchant_id / 150. Esa consulta no creó otra autorización. El resultado ics_decision_early / 100 pertenece a otra aplicación y no convierte la autorización fallida en un pago aprobado.

No se confirma captura ni liquidación por un resultado de autenticación. No se enviaron avisos al Portal. 

## Solicitud preparada para BAC

Nuestro único Organization ID sandbox proporcionado por BAC es test_bac_hn_bodegsegurasroatan. Se envía correctamente como v-c-merchant-id a https://apitest.cybersource.com. La firma REST funciona, Microform funciona y 3D Secure termina correctamente.

Solicitamos confirmar si este Organization ID sandbox tiene correctamente configurado el Merchant ID del adquirente/procesador para **Card Payments Authorization**. Pay no envía explícitamente acquirerInformation.merchantId ni acquirerInformation.acquirerMerchantId. Si BAC requiere alguno de esos campos en la solicitud, necesitamos la documentación aplicable y el valor de pruebas asignado oficialmente; no se utilizarán valores inventados.

Referencia para revisar:

- Fecha de autorización: 2026-09-26 20:52:46 UTC.
- Importe: 1.00 USD; Visa oficial de ensayo terminada en 1005.
- Request ID financiero: 7904559671966651104805.
- Referencia de comercio: RSS-42787d02-7914-4203-9701-1e193e1ff8a3-1.
- Setup: 7904559598786645104805.
- Autenticación exitosa: 7904559666776869404806, PARes Y.
- Error: Payment processor error: This field is invalid or missing: merchant_id; ics_auth / ESYSTEM / 150 / -1.

El error está localizado en la autorización del procesador. BAC debe confirmar el ajuste concreto requerido en el perfil; este reporte no presume cuál es ese ajuste. Caso preparado, sin enviar mensajes a terceros.

## JSON de autorización enviado (valores sensibles ocultos)

```json
{
  "clientReferenceInformation": {
    "code": "RSS-42787d02-7914-4203-9701-1e193e1ff8a3-1"
  },
  "processingInformation": {
    "capture": true,
    "commerceIndicator": "vbv"
  },
  "tokenInformation": {
    "jti": "[REDACTED]"
  },
  "paymentInformation": {
    "card": {
      "type": "001"
    }
  },
  "deviceInformation": {
    "ipAddress": "[REDACTED]",
    "httpAcceptContent": "[REDACTED]",
    "httpBrowserLanguage": "[REDACTED]",
    "httpBrowserColorDepth": "[REDACTED]",
    "userAgentBrowserValue": "[REDACTED]",
    "httpBrowserJavaEnabled": "[REDACTED]",
    "httpBrowserScreenWidth": "[REDACTED]",
    "httpBrowserScreenHeight": "[REDACTED]",
    "httpBrowserTimeDifference": "[REDACTED]",
    "httpBrowserJavaScriptEnabled": "[REDACTED]"
  },
  "orderInformation": {
    "amountDetails": {
      "totalAmount": "1.00",
      "currency": "USD"
    },
    "billTo": {
      "email": "[REDACTED]",
      "country": "[REDACTED]",
      "address1": "[REDACTED]",
      "lastName": "[REDACTED]",
      "locality": "[REDACTED]",
      "firstName": "[REDACTED]",
      "postalCode": "[REDACTED]",
      "administrativeArea": "[REDACTED]"
    }
  },
  "buyerInformation": {
    "merchantCustomerId": "[REDACTED]"
  },
  "consumerAuthenticationInformation": {
    "cavv": "[REDACTED]",
    "xid": "[REDACTED]",
    "directoryServerTransactionId": "[REDACTED]",
    "specificationVersion": "2.2.0",
    "authenticationTransactionId": "[REDACTED]"
  }
}
```

## Documentación oficial

- [Encabezados REST, incluido v-c-date y v-c-merchant-id](https://developer.cybersource.com/docs/cybs/en-us/platform/developer/all/rest/rest-getting-started/restgs-http-message-intro/restgs-http-message-conf-intro/restgs-http-const-elements.html).
- [Acquirer Merchant ID asignado por el adquirente](https://developer.cybersource.com/docs/cybs/en-us/api-fields/reference/all/rest/api-fields/acq-info-aa/acq-info-acqirer-merchant-id.html).
- [Tarjeta oficial, caso 2.1](https://developer.cybersource.com/library/documentation/dev_guides/Payer_Authentication_SCMP_API/html/Topics/Test_Cases_for_3D_Secure_2_x.htm).

Evidencia estructurada privada: .private/authorization-diagnostic-05446d87-5797-464e-abeb-fb857bbde034.json.
