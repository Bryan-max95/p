# Comparación de importes en CyberSource sandbox

Ejecución: 2026-09-28T07-04-40-751Z. Solicitudes reales al sandbox con tarjetas oficiales de ensayo.

Cada caso utiliza una sesión e intento nuevos. No se reenvió ningún pago incierto, no se consultaron IDs históricos ni se enviaron avisos al Portal.

| Tarjeta | USD | Autenticación | Resultado de pago | Request ID financiero | Detalle |
| --- | ---: | --- | --- | --- | --- |
| Visa | 1.00 | AUTHENTICATION_SUCCESSFUL | HTTP_502 | 7905791290946866704807 | merchant_id / 150 |
| Visa | 2.00 | AUTHENTICATION_SUCCESSFUL | HTTP_502 | 7905791398646983704805 | merchant_id / 150 |
| Visa | 5.00 | AUTHENTICATION_SUCCESSFUL | HTTP_502 | 7905791489806994804805 | merchant_id / 150 |
| Visa | 10.00 | AUTHENTICATION_SUCCESSFUL | HTTP_502 | 7905791567076909304807 | merchant_id / 150 |

## Resultado con credenciales del entorno privado

La ejecuci?n utiliz? ?nicamente `CYBERSOURCE_MERCHANT_ID`, `CYBERSOURCE_KEY_ID` y `CYBERSOURCE_SHARED_SECRET` desde el entorno privado del servidor, configurado en `.env.local`. El c?digo no lee ni sustituye credenciales desde Neon. Se mantuvo el Organization ID `test_bac_hn_bodegsegurasroatan` y el endpoint `https://apitest.cybersource.com`.

- Cuatro sesiones nuevas, Visa de prueba terminada en 1005 y un intento por sesi?n.
- Cuatro autenticaciones correctas: `AUTHENTICATION_SUCCESSFUL`, PARes `Y`.
- Ninguna autorizaci?n aprobada: las cuatro devolvieron `HTTP_502 / SYSTEM_ERROR`. Los registros de CyberSource confirman `ics_auth / ESYSTEM / 150` y referencia a `merchant_id`.
- Los importes, monedas, referencias y Request ID coinciden con cada sesi?n. La consulta inicial del caso de 10 USD no estuvo disponible; una consulta GET posterior confirm? el detalle, sin reenviar el pago.
- Cero avisos al Portal. Los intentos quedan en estado `unknown`, sin comprobante de pago aprobado.
- La lectura exclusiva desde las variables no resolvi? el error financiero. No se modificaron Storeganise, importes reales, dise?o ni el flujo 3DS durante estas pruebas.

## Referencias para buscar en Business Center

- **Visa, 1.00 USD**: referencia `RSS-ba154b3f-4447-4cc7-85cf-e6e70f8371af-1`; Setup `7905791239826858404807`; autenticación `7905791288376866604807`.
- **Visa, 2.00 USD**: referencia `RSS-fa064dbd-1fd9-4996-8b36-32d0de878dcd-1`; Setup `7905791367936980004805`; autenticación `7905791395416983004805`.
- **Visa, 5.00 USD**: referencia `RSS-90b8078c-2afa-44a5-8e33-38cecdfd62ac-1`; Setup `7905791461266888404807`; autenticación `7905791486676994004805`.
- **Visa, 10.00 USD**: referencia `RSS-0512e4b0-70cc-4a84-8423-1c3f49ee9613-1`; Setup `7905791543226005704805`; autenticación `7905791564336010804805`.

Fuente de tarjetas: [caso 2.1 de CyberSource](https://developer.cybersource.com/library/documentation/dev_guides/Payer_Authentication_SCMP_API/html/Topics/Test_Cases_for_3D_Secure_2_x.htm). Se usó enero del año actual más tres. Los resultados de autenticación y autorización financiera se evalúan por separado.

Datos estructurados: `.private/amount-matrix-2026-09-28T07-04-40-751Z/results.json`.
