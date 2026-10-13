# Pruebas y preparación de producción

**Actualización del 13 de octubre de 2026:** se volvió a `CYBERSOURCE_ENVIRONMENT=sandbox` en `.env.local` para que el comercio realice las pruebas manualmente contra `https://apitest.cybersource.com`. Credenciales conservadas; no se ejecutaron cobros al cambiar la configuración. Seguir [PRUEBAS_MANUALES_SANDBOX.md](PRUEBAS_MANUALES_SANDBOX.md). Los resultados y la selección de producción descritos abajo corresponden al 9 de octubre.

Revisión histórica del 9 de octubre de 2026.

## Resultado de las tres pruebas solicitadas

| Importe | 3DS | Resultado | Transacción financiera |
| --- | --- | --- | --- |
| L100.00 | Exitoso | AUTHORIZED | 7915657183096148104806 |
| L200.00 | Exitoso | AUTHORIZED | 7915657370126162304806 |
| L1,000.00 | Exitoso | AUTHORIZED | 7915657520436991304805 |

Se hicieron **tres pagos sandbox con Visa de prueba**, uno por importe. La consulta posterior de cada ID confirmó importe y moneda HNL, y los servicios `ics_auth` e `ics_bill` respondieron `SOK / 100`. Hubo un intento por sesión y cero avisos al Portal. No se efectuaron cargos de producción.

Evidencia: [informe de las pruebas](RESULTADOS_PRUEBAS_100_200_1000_HNL_SANDBOX.md) y `.private/amount-matrix-hnl-2026-10-09T17-07-46-102Z/results.json`. Estos casos fueron importes HNL directos; no requerían convertir un precio USD.

## Selección de entorno

`CYBERSOURCE_ENVIRONMENT` selecciona conjuntamente API, Microform, claves públicas y Cardinal/3DS:

| Componente | Sandbox | Producción |
| --- | --- | --- |
| API | apitest.cybersource.com | api.cybersource.com |
| Microform | testflex.cybersource.com | flex.cybersource.com |
| Cardinal | centinelapistag.cardinalcommerce.com | centinelapi.cardinalcommerce.com |

Por indicación del comercio, ambos endpoints usan las mismas tres variables existentes de BAC, sin duplicarlas. Sus valores se conservaron exactamente:

```dotenv
CYBERSOURCE_ENVIRONMENT=production
CYBERSOURCE_MERCHANT_ID=<valor existente>
CYBERSOURCE_KEY_ID=<valor existente>
CYBERSOURCE_SHARED_SECRET=<valor existente>
PAY_PUBLIC_URL=https://payroatanselfstorage.com
PAY_DEMO_ENABLED=false
```

**Estado del 9 de octubre:** `.env.local` seleccionaba producción y el dominio `https://payroatanselfstorage.com`, con demos desactivadas. El 13 de octubre se cambió únicamente el entorno bancario a sandbox. Esto configura la aplicación local; no despliega Vercel ni configura DNS.

**Verificación real del 9 de octubre de 2026, 17:27:11 UTC:** `POST https://api.cybersource.com/microform/v2/sessions` respondió **HTTP 401**, usando las credenciales existentes. Se solicitó únicamente un contexto de tarjeta, sin datos de tarjeta, importe, autorización ni captura. La conexión llegó a CyberSource, pero la autenticación fue rechazada. BAC debe verificar la habilitación y validez de estas credenciales para ese endpoint. No se puede afirmar que producción esté operativa ni que se acrediten fondos a la empresa. Evidencia sin secretos: `.private/production-check-latest.json`.

Por indicación del comercio, **no se harán más pruebas automáticas contra producción**. Desde el 13 de octubre el carrusel usa `apitest.cybersource.com` para que una persona introduzca la tarjeta de prueba y confirme el pago. La opción `--live` fue retirada y se rechaza sin conexión al banco. `pay:check` solo permite sandbox y no se ejecutó para este cambio. El resultado HTTP 401 anterior queda como antecedente; no se ha repetido la consulta.

En Vercel deben configurarse estas mismas variables como privadas y asociarse el dominio. Este comando revisa únicamente la configuración local, sin peticiones de red ni validación bancaria:

```powershell
pnpm pay:production-check
```

Las sesiones guardan su entorno. Los pagos nuevos rechazan sesiones de otro entorno; la conciliación consulta el entorno original. Las demos y el diagnóstico de autorización están deshabilitados en producción. El endpoint de anulación para pruebas no permite que un cliente anule un cobro de producción.

El siguiente paso operativo es publicar en Vercel, asociar `payroatanselfstorage.com` y crear el enlace privado explicado a continuación. El operador abre el enlace, revisa el cliente y el importe, introduce la tarjeta y pulsa «Pagar Ahora». No se ha desplegado ni ejecutado ese pago desde aquí.

## Cobro manual mediante enlace

La modalidad preparada permite que **el operador defina el monto**, y que **el cliente introduzca su tarjeta y confirme el pago**. Crear el enlace no inicia un cargo. No hay cobros recurrentes automáticos.

1. Copiar `examples/manual-checkout.json` a `.private/cobro.json`.
2. Sustituir los datos de ejemplo por cliente, bodega, referencia única, datos reales de facturación y monto en USD.
3. Crear el enlace desde el equipo/servidor autorizado:

```powershell
pnpm pay:manual --file=.private/cobro.json
```

El resultado se guarda en `.private/manual-<id>.json`; contiene `launchUrl` y el vencimiento. Compartir ese enlace con el cliente. Es de un solo uso y permite iniciar el pago durante 30 minutos.

El mismo `reference` reutiliza la misma sesión; no crea otro cobro ni renueva el vencimiento. No reutilizar referencias para mensualidades distintas. El carrusel muestra el USD original, calcula HNL con BCH y presenta el débito antes de confirmar. El cliente no puede modificar el monto. Esta implementación no incluye un formulario público para que el cliente escriba cualquier importe.

Un pago manual conserva comprobante y datos de cliente/bodega, pero **no se registra automáticamente en Storeganise ni activa el alquiler**. Debe aplicarse operativamente hasta terminar esa integración. El comprobante indica que la aplicación a la cuenta corresponde a Roatan Self Storage.

## Entrada desde Storeganise

El modelo de checkout conserva cliente, factura/pedido, bodega y precio obtenido por el servidor; el formulario de tarjeta no acepta montos. Las pruebas automatizadas verifican esa separación y el rechazo de importes manipulados.

El manejador existente de Storeganise sigue limitado al contrato de ensayo. Los checkouts de producción de Storeganise se rechazan antes de cobrar hasta implementar el registro del pago, confirmar el contrato/API y configurar el secreto de webhooks. Falta conectar el recorrido completo Pay → Storeganise → Portal; no basta con activar eventos para que esa escritura ocurra. El Portal se considera listo según lo indicado por el usuario.

## Validación local

Se ejecutaron 40 pruebas automatizadas, incluyendo credenciales compartidas para ambos endpoints, firma del host seleccionado, claves de Microform por entorno, CSP/3DS, sesión manual sin cobro y monto USD/HNL inmutable. Los casos de producción de la suite usan respuestas simuladas; el resultado real de conexión es el HTTP 401 descrito arriba.

TypeScript, ESLint de los archivos modificados y `pnpm build` finalizaron correctamente con la configuración de producción. La compilación mostró advertencias de caché de webpack, sin errores de compilación.

También se abrió un enlace manual real en sandbox sin iniciar el pago: conservó USD199.00 y HNL5,350.77, tasa BCH 26.888300 del 7 de octubre, con cero intentos y cero avisos al Portal. La revisión de interfaz en español/inglés y tamaños móvil/escritorio pasó.

Fuentes oficiales: [endpoints CyberSource](https://developer.cybersource.com/docs/cybs/en-us/endpoints/reference/all/na/endpoints/endpoints.html), [Cardinal y recolección del dispositivo](https://developer.cybersource.com/docs/cybs/en-us/payer-authentication/developer/all/rest/payer-auth/pa2-ccdc-ddc-intro/pa2-ccdc-ddc-listen-URL-response.html).
