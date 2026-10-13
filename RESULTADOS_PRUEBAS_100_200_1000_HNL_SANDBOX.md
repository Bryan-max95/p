# Comparación de importes en CyberSource sandbox

Ejecución: 2026-10-09T17-07-46-102Z. Solicitudes reales al sandbox con tarjetas oficiales de ensayo.

Cada caso utiliza una sesión e intento nuevos. No se reenvió ningún pago incierto, no se consultaron IDs históricos ni se enviaron avisos al Portal.

| Tarjeta | HNL | Autenticación | Resultado de pago | Request ID financiero | Detalle |
| --- | ---: | --- | --- | --- | --- |
| Visa | 100.00 | AUTHENTICATION_SUCCESSFUL | AUTHORIZED | 7915657183096148104806 | — |
| Visa | 200.00 | AUTHENTICATION_SUCCESSFUL | AUTHORIZED | 7915657370126162304806 | — |
| Visa | 1000.00 | AUTHENTICATION_SUCCESSFUL | AUTHORIZED | 7915657520436991304805 | — |

## Referencias para buscar en Business Center

- **Visa, 100.00 HNL**: referencia `RSS-67a9e52a-199e-4279-995c-75b1b8922143-1`; Setup `7915657103256142104806`; autenticación `7915657175826855504807`.
- **Visa, 200.00 HNL**: referencia `RSS-96fadc0d-58dd-40d0-bd23-f6f5bcc855d8-1`; Setup `7915657309216864304807`; autenticación `7915657364086161604806`.
- **Visa, 1000.00 HNL**: referencia `RSS-db11cad7-567f-447c-a73a-2c255cd5f7e6-1`; Setup `7915657476786171604806`; autenticación `7915657517006990804805`.

Fuente de tarjetas: [caso 2.1 de CyberSource](https://developer.cybersource.com/library/documentation/dev_guides/Payer_Authentication_SCMP_API/html/Topics/Test_Cases_for_3D_Secure_2_x.htm). Se usó enero del año actual más tres. Los resultados de autenticación y autorización financiera se evalúan por separado.

Datos estructurados: `.private/amount-matrix-hnl-2026-10-09T17-07-46-102Z/results.json`.

## Precio en dólares y verificación de moneda

- 100.00 HNL: importe HNL directo, sin conversion USD en este caso; proveedor 100.00 HNL.
- 200.00 HNL: importe HNL directo, sin conversion USD en este caso; proveedor 200.00 HNL.
- 1000.00 HNL: importe HNL directo, sin conversion USD en este caso; proveedor 1000.00 HNL.

## Verificacion posterior del proveedor

Los tres IDs financieros devolvieron los importes solicitados en HNL. En los tres casos, `ics_auth` e `ics_bill` respondieron `SOK / 100`. Un intento por sesion y cero avisos al Portal.
