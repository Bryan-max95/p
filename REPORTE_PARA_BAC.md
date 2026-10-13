# Reporte para BAC Credomatic — autorización CyberSource sandbox

Fecha: 28 de septiembre de 2026.

**Asunto sugerido:** Revisión de autorización sandbox, razón 150 / merchant_id, y requisitos para producción.

Estimado equipo de BAC Credomatic:

Estamos integrando el comercio Roatan Self Storage con el Organization ID sandbox que nos proporcionaron: `test_bac_hn_bodegsegurasroatan`.

Usamos la API REST `https://apitest.cybersource.com`, Microform v2 y Payer Authentication. La integración utiliza exclusivamente las variables privadas `CYBERSOURCE_MERCHANT_ID`, `CYBERSOURCE_KEY_ID` y `CYBERSOURCE_SHARED_SECRET`, con las credenciales existentes del comercio. El Organization ID se envía como `v-c-merchant-id` y la firma se genera en el servidor.

La creación del contexto Microform y su verificación de firma funcionan. En la última ejecución, los cuatro casos finalizaron 3DS con `AUTHENTICATION_SUCCESSFUL` y `PARes: Y`. Sin embargo, la llamada posterior a `POST /pts/v2/payments` devolvió `HTTP 502 / SYSTEM_ERROR`. La consulta de cada Request ID confirma `ics_auth / ESYSTEM / 150`, con referencia a `merchant_id` en el mensaje del procesador. No obtuvimos ninguna autorización aprobada.

## Evidencia de la última ejecución

Inicio de la ejecución: `2026-09-28T07:04:40.751Z` (UTC). Visa oficial de prueba terminada en `1005`; sesiones independientes y un intento por sesión.

| Importe | Request ID de autenticación | Request ID de autorización | Resultado financiero |
| --- | --- | --- | --- |
| 1.00 USD | 7905791288376866604807 | 7905791290946866704807 | ESYSTEM / 150 / merchant_id |
| 2.00 USD | 7905791395416983004805 | 7905791398646983704805 | ESYSTEM / 150 / merchant_id |
| 5.00 USD | 7905791486676994004805 | 7905791489806994804805 | ESYSTEM / 150 / merchant_id |
| 10.00 USD | 7905791564336010804805 | 7905791567076909304807 | ESYSTEM / 150 / merchant_id |

Los importes, monedas y referencias fueron contrastados con los registros de CyberSource. No se reenviaron pagos inciertos. Los escenarios usan datos locales de ensayo, sin avisos al Portal ni aplicación a facturas de clientes reales.

## Revisión solicitada

1. Confirmar que el Organization ID indicado corresponde al comercio transaccional habilitado para **Card Payments Authorization** y captura en sandbox.
2. Revisar la asociación y configuración del identificador del comercio ante el adquirente/procesador que utiliza esta cuenta. El error aparece en la etapa de autorización, después de la autenticación 3DS correcta. El código 150 por sí solo no permite atribuir definitivamente la causa a un campo de nuestra solicitud.
3. Confirmar si esta integración requiere enviar algún identificador adicional en el cuerpo REST. Actualmente no enviamos `merchant_id`, `acquirerInformation.merchantId` ni `acquirerInformation.acquirerMerchantId`. Si BAC requiere un campo, solicitamos su ruta exacta, valor asignado, documentación y ejemplo de solicitud; no añadiremos un identificador inventado.
4. Indicar los casos de prueba y criterios de aceptación exigidos por BAC para Visa, Mastercard, American Express, 3DS, autorización, captura y anulación/reverso, según los servicios contratados.
5. Indicar el procedimiento de habilitación de producción: Organization ID que corresponde utilizar, servicios y monedas habilitados, usuarios, generación de llaves de producción y validación desde el dominio `https://www.payroatanselfstorage.com`.

Solicitamos su diagnóstico sobre estos Request ID y los siguientes pasos para completar las pruebas. Este reporte acredita comunicación y autenticación sandbox; no acredita aprobación financiera ni autorización para operar en producción.

## Referencias oficiales

- [Guía de pruebas CyberSource](https://developer.cybersource.com/hello-world/testing-guide.html): sandbox y producción son entornos separados y requieren credenciales separadas; las tarjetas de ensayo corresponden a sandbox.
- [Activación del Organization ID](https://support.visaacceptance.com/knowledgebase/knowledgearticle/?code=000002034): activación, configuración del procesador y habilitación de servicios.
- [Configuración de producción](https://support.visaacceptance.com/knowledgebase/article/000002993/en-us): confirmación de estado Live, nuevas llaves de producción y pruebas de extremo a extremo.

Este documento no incluye Shared Secret, llaves de seguridad de Pay, datos completos de tarjeta ni credenciales de base de datos.
