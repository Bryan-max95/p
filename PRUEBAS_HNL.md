# Cobros sandbox en lempiras

Actualización: 2 de octubre de 2026.

Las nuevas demos cobran **100.00, 150.00 o 200.00 HNL**. El importe y la moneda se fijan en el servidor y se conservan durante 3DS, autorización, consulta posterior y comprobante. El navegador no puede enviar otro monto o moneda. Los escenarios anteriores en USD se conservan como historial; sus intentos inciertos no se reenvían.

## Abrir las pruebas

- [L100](http://localhost:3000/?scenario=hnl100)
- [L150](http://localhost:3000/?scenario=hnl150)
- [L200](http://localhost:3000/?scenario=hnl200)

El selector superior crea una sesión nueva. **Nueva prueba** conserva el importe elegido. La apertura directa usa L100.

## Precio de referencia en dólares

`PAY_USD_HNL_RATE` define cuántos lempiras equivalen a USD 1. La tasa debe ser proporcionada por el comercio. No se ha configurado una tasa por defecto ni se consulta un tipo de cambio bancario automáticamente.

Cuando se configura, cada sesión nueva conserva la tasa y el equivalente USD redondeado a dos decimales. Cambiar la tasa no modifica sesiones ya creadas. El precio USD es informativo: el monto HNL es el que se envía a CyberSource, se guarda y se muestra en el botón y el comprobante.

Si falta la tasa, se muestra **Tasa pendiente** en la referencia USD. Las pruebas de L100, L150 y L200 pueden realizarse porque su importe HNL ya está definido. Las sesiones antiguas sin tasa no reciben una conversión inventada.

## Comandos

```powershell
# Interfaz, recarga, aislamiento, monto protegido y Nueva prueba; sin solicitar pagos.
node --env-file=.env.local --import tsx scripts/pay-amount-matrix.ts --brand=visa

# Tres sesiones nuevas y un intento de pago sandbox por sesión.
node --env-file=.env.local --import tsx scripts/pay-amount-matrix.ts --brand=visa --pay
```

El script requiere el servidor local abierto y tarjetas oficiales de ensayo. Con `--pay` y sin `--brand`, ejecuta nueve casos (tres marcas por tres importes). No se ejecuta esta matriz ampliada automáticamente.

Los resultados HNL se guardan en `RESULTADOS_MONTOS_HNL_SANDBOX.md` y `.private/amount-matrix-hnl-<fecha>/`; los resultados históricos USD permanecen en `RESULTADOS_MONTOS_SANDBOX.md`. Las consultas contrastan referencia, importe y moneda contra los registros del proveedor. Un resultado de 3DS exitoso no se interpreta como pago aprobado.

Las demos no envían avisos al Portal ni aplican pagos a facturas reales.

## Resultado del 2 de octubre

Las tres pruebas Visa fueron aprobadas: `AUTHENTICATION_SUCCESSFUL`, PARes `Y`, y `AUTHORIZED`. La consulta de cada Request ID confirmó el monto en HNL y `ics_auth / SOK / 100` e `ics_bill / SOK / 100`. No se repitió el error `merchant_id / 150` observado en USD. La consulta inicial de L200 aún no estaba disponible; una consulta GET posterior confirmó el resultado, sin reenviar el pago.

TypeScript, ESLint y 21 pruebas automatizadas pasaron. La comprobación final del navegador verificó los tres importes, recarga, sesiones nuevas y rechazo de montos arbitrarios. Una primera comprobación de interfaz recibió un 503 transitorio al crear una nueva demo; la repetición sin pagos completó los tres escenarios. La ejecución financiera posterior creó exactamente tres intentos, todos aprobados.

La referencia USD queda pendiente de la tasa del comercio. No se cambiaron credenciales ni se activó producción.

Referencia: [códigos de moneda de CyberSource](https://developer.cybersource.com/content/dam/docs/cybs/en-us/currency-codes/reference/all/na/currency-codes.pdf), HNL, dos decimales. La aceptación del comercio se comprueba con sus resultados sandbox.
