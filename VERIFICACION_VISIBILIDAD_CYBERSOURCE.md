# Comprobación de visibilidad en CyberSource

Consulta realizada el 26/09/2026 a las 22:24:47 UTC. Se utilizó la cuenta sandbox existente `test_bac_hn_bodegsegurasroatan`.

## Qué se comprobó

Después de que el usuario informó que ya no veía transacciones en Business Center, se realizaron dos búsquedas mediante `POST https://apitest.cybersource.com/tss/v2/searches`, con `save: "false"`. Son consultas de búsqueda, no solicitudes de pago.

| Consulta | Resultado de CyberSource |
| --- | --- |
| Los cuatro Request ID financieros de la última prueba | HTTP 201; `totalCount: 4` |
| Las cuatro referencias RSS, incluyendo todas las etapas | HTTP 201; `totalCount: 12` |

Los 12 registros corresponden a cuatro `ics_pa_setup` con razón 100, cuatro `ics_pa_enroll` con razón 100 y cuatro solicitudes con `ics_auth` en `ESYSTEM / 150`. Los cuatro registros financieros coinciden en cuenta, referencia, importe y moneda con las pruebas guardadas.

El HTTP 201 anterior significa que se ejecutó la búsqueda. No cambia el resultado de autorización de las pruebas ni significa que se haya aprobado un pago.

## Fecha exacta de las autorizaciones

| Monto USD | Fecha UTC | Hora en Honduras, 26/09/2026 (UTC−6) | Request ID |
| ---: | --- | --- | --- |
| 1.00 | 2026-09-26 22:14:49 | 16:14:49 | `7904608893806447404805` |
| 2.00 | 2026-09-26 22:15:00 | 16:15:00 | `7904609002896672304806` |
| 5.00 | 2026-09-26 22:15:08 | 16:15:08 | `7904609080416678004806` |
| 10.00 | 2026-09-26 22:15:15 | 16:15:15 | `7904609152926469104805` |

La hora que muestra Business Center depende de la zona horaria seleccionada en esa cuenta. Una búsqueda por Request ID sin filtros de estado y con todo el día incluido permite evitar diferencias por hora.

## Conclusión y límite de la comprobación

Los registros existen y el servicio de búsqueda de CyberSource los encuentra, incluyendo sus errores. No hay evidencia de que hayan desaparecido del índice de búsqueda. Esta comprobación no da acceso a la pantalla ni a la sesión de Business Center del usuario; por eso todavía no se conoce la causa exacta de su lista vacía.

Para diagnosticar esa diferencia se necesita comprobar la dirección de Business Center, la organización seleccionada, el rango de fechas y los filtros de la pantalla donde ocurre. No corresponde atribuir la lista vacía al error de autorización 150: la búsqueda realizada devuelve precisamente esos registros fallidos.

Evidencia filtrada sin credenciales ni datos de tarjeta: `.private/latest-search-visibility.json`.

Referencia: [Transaction Search and Details API, documentación oficial](https://developer.cybersource.com/docs/cybs/en-us/txn-search/developer/all/rest/txn-search.html).
