# Comparación de importes en CyberSource sandbox

Ejecución: 2026-10-02T22-53-56-885Z. Solicitudes reales al sandbox con tarjetas oficiales de ensayo.

Cada caso utiliza una sesión e intento nuevos. No se reenvió ningún pago incierto, no se consultaron IDs históricos ni se enviaron avisos al Portal.

| Tarjeta | HNL | Autenticación | Resultado de pago | Request ID financiero | Detalle |
| --- | ---: | --- | --- | --- | --- |
| Visa | 100.00 | AUTHENTICATION_SUCCESSFUL | AUTHORIZED | 7909816558806877804805 | — |
| Visa | 150.00 | AUTHENTICATION_SUCCESSFUL | AUTHORIZED | 7909816667866888504805 | — |
| Visa | 200.00 | AUTHENTICATION_SUCCESSFUL | AUTHORIZED | 7909816773816160904806 | — |

## Referencias para buscar en Business Center

- **Visa, 100.00 HNL**: referencia `RSS-1c7381eb-76d0-4cab-8f12-f0596b28221e-1`; Setup `7909816510736872604805`; autenticación `7909816555566141904806`.
- **Visa, 150.00 HNL**: referencia `RSS-7fcfc1ce-5851-49ed-beb4-ca1b4e7d7d68-1`; Setup `7909816637916885904805`; autenticación `7909816665036151504806`.
- **Visa, 200.00 HNL**: referencia `RSS-efb9d0d7-98d7-43f1-8ebd-f6b09372c551-1`; Setup `7909816739036157904806`; autenticación `7909816770156899104805`.

Fuente de tarjetas: [caso 2.1 de CyberSource](https://developer.cybersource.com/library/documentation/dev_guides/Payer_Authentication_SCMP_API/html/Topics/Test_Cases_for_3D_Secure_2_x.htm). Se usó enero del año actual más tres. Los resultados de autenticación y autorización financiera se evalúan por separado.

Datos estructurados: `.private/amount-matrix-hnl-2026-10-02T22-53-56-885Z/results.json`.

## Precio en dólares y verificación de moneda

- 100.00 HNL: referencia USD pendiente de tasa comercial; tasa HNL/USD sin configurar; proveedor 100.00 HNL.
- 150.00 HNL: referencia USD pendiente de tasa comercial; tasa HNL/USD sin configurar; proveedor 150.00 HNL.
- 200.00 HNL: referencia USD pendiente de tasa comercial; tasa HNL/USD sin configurar; proveedor 200.00 HNL (confirmado mediante consulta GET posterior).

## Confirmación posterior de los tres casos

Consulta GET de los mismos Request ID, sin reenviar pagos: 2026-10-02T22:56:43.160Z.

- **L 100.00 HNL**, Request ID `7909816558806877804805`: ics_auth: SOK / 100; ics_bill: SOK / 100; ics_decision_early:  / 100. Un intento y cero entregas al Portal.
- **L 150.00 HNL**, Request ID `7909816667866888504805`: ics_auth: SOK / 100; ics_bill: SOK / 100; ics_decision_early:  / 100. Un intento y cero entregas al Portal.
- **L 200.00 HNL**, Request ID `7909816773816160904806`: ics_auth: SOK / 100; ics_bill: SOK / 100; ics_decision_early:  / 100. Un intento y cero entregas al Portal.
