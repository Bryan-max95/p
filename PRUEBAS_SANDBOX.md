# Pruebas de Pay con Neon y CyberSource sandbox

El proyecto utiliza exclusivamente `https://apitest.cybersource.com`. La configuración privada se encuentra en `.env.local`, excluido del control de versiones. Las llaves de CyberSource se almacenan en Neon cifradas con AES-256-GCM. La clave de descifrado permanece en el servidor, fuera de la base de datos.

La comparación solicitada ahora admite **1.00, 2.00, 5.00 y 10.00 USD** mediante escenarios definidos en el servidor. El valor por defecto sigue siendo 1.00 USD. Esta lista reemplaza la restricción anterior de un dólar para demos; las facturas e intentos históricos conservan su monto original y no se reenvían.

## Comparación de marcas e importes

Abre estos enlaces en pestañas nuevas independientes para elegir el importe de una demo local:

| Importe | Enlace |
| --- | --- |
| 1.00 USD | [Abrir prueba de 1 USD](http://localhost:3000/?scenario=usd1) |
| 2.00 USD | [Abrir prueba de 2 USD](http://localhost:3000/?scenario=usd2) |
| 5.00 USD | [Abrir prueba de 5 USD](http://localhost:3000/?scenario=usd5) |
| 10.00 USD | [Abrir prueba de 10 USD](http://localhost:3000/?scenario=usd10) |

El monto continúa como solo lectura. Recargar conserva sesión e importe; **Nueva prueba** crea otra sesión para el mismo escenario. Una sesión con resultado incierto no cambia de monto ni se reutiliza para otro cargo.

La matriz utiliza Visa, Mastercard y American Express del caso oficial 2.1 (autenticación sin desafío exitosa), con fecha enero del año actual más tres. La autorización del procesador se evalúa por separado: esos números no garantizan que el perfil BAC esté habilitado para aprobar el pago. El detalle de tarjetas está en la [guía oficial de CyberSource](https://developer.cybersource.com/library/documentation/dev_guides/Payer_Authentication_SCMP_API/html/Topics/Test_Cases_for_3D_Secure_2_x.htm).

```powershell
# Cuatro escenarios: interfaz, recarga, monto protegido y Nueva prueba, sin cobrar
node --env-file=.env.local --import tsx scripts/pay-amount-matrix.ts

# 12 solicitudes de pago sandbox nuevas, sin reintentar las inciertas
node --env-file=.env.local --import tsx scripts/pay-amount-matrix.ts --pay
```

El informe financiero se guarda en `RESULTADOS_MONTOS_SANDBOX.md`. Cada ejecución conserva además su propio JSON y Markdown en `.private/amount-matrix-<fecha>/`. Se muestran los IDs de setup, autenticación y pago sin JWTs, PAN ni CVV. La comprobación posterior consulta únicamente los IDs financieros nuevos de esa ejecución. El script no inicia Next.js ni notifica al Portal; devuelve código distinto de cero si hay casos incompletos o pagos no aprobados.

Ejecución comprobada el 26 de septiembre a las 17:38 UTC: los 12 casos completaron autenticación (`Y`); los 12 intentos financieros devolvieron HTTP 502 y el procesador confirmó `ESYSTEM / 150`, `merchant_id` inválido o ausente. Cero aprobaciones, un intento por sesión y cero entregas al Portal. Los IDs y referencias nuevos están en [RESULTADOS_MONTOS_SANDBOX.md](RESULTADOS_MONTOS_SANDBOX.md). También pasaron TypeScript, ESLint, diez pruebas automatizadas y la verificación de interfaz de los cuatro importes.

## Comprobaciones disponibles

- `pnpm pay:setup`: crea el esquema sin borrar tablas, genera secretos locales si faltan e importa las credenciales cifradas. Elimina del archivo local el Key ID y Shared Secret después de verificar su recuperación.
- `pnpm pay:check`: solicita un contexto real de Microform en sandbox y verifica su firma RSA. No cobra tarjetas, no inicia Next.js y no imprime credenciales ni tokens.
- `pnpm pay:demo`: crea dos sesiones independientes en Neon por 1.00 USD cada una. Sus enlaces se guardan en `.private/DEMO.md`. Cada enlace se puede usar una vez y caduca en 30 minutos.
- `pnpm typecheck` y `pnpm lint`: revisan el código sin iniciar el servidor.

## Demostración en el servidor que ya está abierto

1. Confirma que `PAY_PUBLIC_URL` corresponde a la dirección real. La configuración local actual utiliza `http://localhost:3000`.
2. Abre directamente `http://localhost:3000`: se crea una sesión sandbox para DEMO-A por 1.00 USD. Para el segundo cliente, abre `http://localhost:3000/?demo=b` en una pestaña nueva independiente (DEMO-B, 1.00 USD). No necesitas entrar desde Storeganise. También puedes generar enlaces con `pnpm pay:demo`.
3. Verifica que cada pestaña muestre su cliente, bodega, concepto y monto. Los campos son de solo lectura.
4. En el paso 2, ingresa una tarjeta **de prueba** en los campos seguros de CyberSource y confirma el pago.
5. El paso 3 aparece únicamente cuando el servidor tiene una autorización del sandbox y una referencia real. Consulta `pay_sessions` y `pay_attempts` en Neon para comprobar el resultado.

Se utiliza una cookie `HttpOnly` por sesión y un identificador de sesión en `sessionStorage` por pestaña. El identificador no autoriza por sí mismo el acceso: también se requiere la cookie correspondiente. Abrir otro cliente no sustituye la sesión de la primera pestaña.

Recargar conserva la sesión y su resultado. El botón **Nueva prueba** permite crear otra sesión. Un enlace explícito `?session=...` siempre tiene prioridad; si está vencido o es inválido no se reemplaza silenciosamente por una demo.

La creación automática exige `NODE_ENV=development`, `PAY_DEMO_ENABLED=true`, dirección de loopback y origen correcto. En una instalación pública permanece desactivada. Si Neon no está disponible, se muestra un error de prueba con opción de reintentar. Cliente, factura, bodega e importe se generan en el servidor; el navegador solo puede escoger la variante A o B.

`pnpm pay:local-check` revisa apertura directa, recarga, aislamiento, Nueva prueba y carga de Microform contra el servidor existente; guarda `.private/local-check.json`. `pnpm pay:local-check --pay` además envía las tarjetas oficiales de los casos 2.1 y 2.2 a sandbox y registra `.private/local-payment-check.json`. No inicia otro servidor. Una respuesta HTTP de Pay por sí sola no acredita un pago aprobado.

Las sesiones marcadas `is_demo=true` nunca crean avisos al Portal. No se conectan a Storeganise, no asignan CAI y no activan bodegas. Son datos ficticios explícitos de ensayo guardados en el servidor; los resultados de pago no se simulan.

## Tarjetas publicadas para sandbox

| Marca | Número de prueba |
| --- | --- |
| Visa | 4111 1111 1111 1111 |
| Mastercard | 5555 5555 5555 4444 |
| American Express | 3782 8224 6310 005 |

Usa una fecha futura y un código de prueba de 3 dígitos para Visa/Mastercard o 4 para Amex. La aprobación o rechazo depende del simulador/procesador del comercio. No confundir una validación local de campo con un rechazo bancario.

Fuente: [guía oficial de pruebas de CyberSource](https://developer.cybersource.com/hello-world/testing-guide.html).

Para los casos de Payer Authentication de la [guía que compartiste](https://developer.cybersource.com/library/documentation/dev_guides/Payer_Authentication_SCMP_API/html/Topics/Test_Cases_for_3D_Secure_2_x.htm): Visa `4456530000001005` corresponde al caso 2.1 y Mastercard `5200000000001013` al 2.2. Usa enero del año actual más tres: en 2026, `01/29`. La autenticación exitosa y la autorización del pago son resultados distintos.

## Resultado comprobado el 25 de septiembre de 2026

**Histórico:** estos resultados corresponden al flujo anterior. La corrección y las nuevas pruebas del 26 de septiembre están en la sección siguiente.

- Apertura directa, dos sesiones con montos/bodegas diferentes, recarga y campos seguros: verificados contra el servidor local existente.
- Intento de modificar el importe al crear demo: HTTP 400. Origen externo: HTTP 403. Identificador sin su cookie: HTTP 401.
- Se corrigió el encabezado `Accept`: con `application/json`, este endpoint devolvía 404 vacío; con `*/*`, responde el procesador. El token se verifica criptográficamente antes de enviar su identificador a la API.
- Mastercard del caso 2.2: `DECLINED / CONSUMER_AUTHENTICATION_FAILED`. Consulta posterior: `ics_pa_enroll`, `DAUTHENTICATIONFAILED`, código 476.
- Visa del caso 2.1: autenticación `ics_pa_enroll / SOK / 100`; autorización `ics_auth / ESYSTEM / 150`, HTTP 502. Transacción de referencia: `7903911168106609604806`.
- Visa general `4111111111111111`: también respondió HTTP 502 / SYSTEM_ERROR. Transacción: `7903912928736666604805`.
- Cada sesión de esta prueba guardó un solo intento y cero entregas al Portal. No se confirmó ninguna autorización aprobada. Los estados inciertos permanecen bloqueados para impedir reintentos del mismo pago.

Para revisar con BAC/CyberSource: comercio sandbox `test_bac_hn_bodegsegurasroatan`, operación `ics_auth`, error `ESYSTEM / 150` e identificadores anteriores. Solicita revisar la autorización del procesador sandbox y sus datos de prueba asignados. La respuesta observada no demuestra por sí sola cuál es la causa de configuración. El [código 150 oficial](https://developer.cybersource.com/library/documentation/dev_guides/Reporting_Users_Guide/html/app_reason_codes.htm) corresponde a un fallo general del sistema.

`node --env-file=.env.local --import tsx scripts/pay-inspect.ts` consulta los dos últimos intentos demo con identificador, sin volver a cobrarlos. `scripts/pay-endpoint-check.ts` envía solicitudes vacías firmadas, sin tarjeta ni posibilidad de cargo, para comprobar la ruta; `--strict-json` reproduce el problema del encabezado.

## Corrección y diagnóstico del 26 de septiembre de 2026

Se conserva el diseño, carrusel, tres pasos e idiomas. Se corrigió el funcionamiento interno:

1. `/api/pay/payments` verifica el token Microform y llama a `/risk/v1/authentication-setups`. Guarda la referencia que devuelve CyberSource; ya no utiliza la referencia RSS del pedido como `referenceId` de 3D Secure.
2. El navegador envía el JWT de setup al iframe de recolección del dispositivo. Espera la respuesta o un máximo de 10 segundos, con los datos reales del navegador como respaldo.
3. `/api/pay/authentication` comprueba sesión, token e intento, y reclama cada etapa una sola vez. Consulta inscripción/autenticación con la referencia del setup. Un rechazo no solicita autorización financiera.
4. Si hay desafío, abre el iframe de Cardinal. El callback verifica origen, ventana de procedencia e identificador; el servidor consulta el resultado a CyberSource. Después de autenticar, solicita el pago con los datos de autenticación devueltos por CyberSource y su `commerceIndicator`, sin ejecutar `VALIDATE_CONSUMER_AUTHENTICATION` otra vez.
5. Un desafío interrumpido por recarga puede cancelarse antes de solicitar el pago. El reinicio y la finalización compiten por el mismo bloqueo de base de datos.
6. La conciliación lee `applicationInformation.applications`, distingue `ics_auth`, `ics_bill` y autenticación, y exige que ID, referencia, monto y moneda correspondan al intento. Solo guarda datos normalizados. La consulta de estado realiza consultas al proveedor con un límite de una cada 30 segundos por intento; no reenvía pagos.
7. Un resultado incierto muestra **Pago pendiente de verificar**, conserva el bloqueo del intento y permite consultar el estado. Una petición que quedó en `processing` más de dos minutos pasa a revisión al consultarla; nunca se habilita automáticamente otro cargo.

Se añadieron de forma aditiva `payment_mode` y `last_reconciled_at` a `pay_attempts`. No se borraron sesiones, tablas ni credenciales.

### Evidencia real

| Prueba | Resultado | ID financiero |
| --- | --- | --- |
| Visa general, solo autorización (`capture:false`), sin autenticación combinada | HTTP 502; consulta posterior `ics_auth / ESYSTEM / 150`, mensaje sobre `merchant_id` inválido o ausente | `7904409386496322304805` |
| Visa, autenticación sin desafío con setup y recolección del dispositivo | Autenticación completada; autorización devuelve el mismo error del procesador | `7904410075776385504805` |
| Mastercard, caso de autenticación fallida, simultáneo con Visa | `AUTHENTICATION_FAILED / CONSUMER_AUTHENTICATION_FAILED`; no se solicitó pago | Ninguno |

Las sesiones simultáneas utilizaron DEMO-A por 1.00 USD y DEMO-B por 2.00 USD; cada una guardó un intento y cero avisos al Portal. El diagnóstico de autorización sin captura también guardó un solo intento y cero avisos.

La prueba aislada confirma que el error no depende de combinar cobro, captura y 3D Secure. El procesador `vdcbaccredhn` sigue rechazando el campo `merchant_id`. Esto apunta a la configuración del procesador del comercio: BAC/CyberSource debe confirmar qué dato o configuración requiere corrección. No se inventó un nuevo Merchant ID ni se sustituyeron las credenciales por otras. **No se obtuvo todavía una autorización aprobada.**

Pruebas adicionales: TypeScript, ESLint y pruebas automatizadas de seguridad/conciliación. La prueba de concurrencia contra Neon verificó un solo inicio, una sola continuación, bloqueo de callbacks de una etapa anterior y rechazo de otra sesión/token. Una respuesta tardía de un intento anterior tampoco puede sobrescribir un intento nuevo. La ventana real del emisor sandbox cargó; un callback falsificado desde la ventana principal fue ignorado y la recuperación tras recargar canceló la autenticación sin solicitar autorización.

### Desafío completado y particularidad de localhost

Se completó el desafío Visa de ensayo terminado en 1096 utilizando el OTP `1234` que muestra el emisor sandbox. Edge bloqueó el retorno del sitio externo a localhost con `ERR_BLOCKED_BY_LOCAL_NETWORK_ACCESS_CHECKS`. La ventana incluye **Ya completé la verificación**: después de ingresar el código en el emisor, esta opción pide al servidor validar el resultado directamente con CyberSource. No salta 3D Secure ni toma la palabra del navegador como aprobación.

La validación se completó y se hizo una sola solicitud financiera de 1.00 USD: `7904426437706091004807`, referencia `RSS-462c7fe4-a9fe-46f0-a2e2-58669c5dcfcb-1`. También devolvió HTTP 502 / SYSTEM_ERROR; la consulta posterior confirmó `ics_auth / ESYSTEM / 150` con `merchant_id` inválido o ausente. El informe está en `.private/challenge-completion.json`. La autenticación del titular quedó comprobada; eso no convierte la autorización financiera fallida en un pago.

Si se consulta antes de que el emisor devuelva PARes, el éxito del servicio de consulta por sí solo no permite cobrar: queda esperando el resultado de la autenticación.

Verificación de la etapa anterior, cuando todas las demos usaban 1.00 USD: TypeScript y ESLint sin errores, diez pruebas automatizadas aprobadas y comprobación de navegador aprobada para ambas sesiones de 1.00 USD, recarga, aislamiento y Nueva prueba. La comparación posterior de 1, 2, 5 y 10 USD está descrita al inicio de este documento y conserva los resultados históricos.

### Comandos sobre el servidor existente

```powershell
# Interfaz y aislamiento; sin enviar pagos
node --env-file=.env.local --import tsx scripts/pay-local-check.ts

# Solicita UNA autorización sandbox sin captura, en una sesión nueva
node --env-file=.env.local --import tsx scripts/pay-local-check.ts --diagnostic

# Dos sesiones simultáneas: autenticación Visa positiva y Mastercard negativa
node --env-file=.env.local --import tsx scripts/pay-local-check.ts --pay

# Desafío real del sandbox y recuperación por recarga; cancela antes del cobro
node --env-file=.env.local --import tsx scripts/pay-challenge-check.ts

# Completa OTP del sandbox, verifica en servidor y solicita el pago de 1 USD
node --env-file=.env.local --import tsx scripts/pay-challenge-check.ts --complete

# Concurrencia en Neon sin invocar CyberSource
node --env-file=.env.local --import tsx scripts/pay-state-check.ts

# Consulta y concilia un intento existente, sin reenviarlo
node --env-file=.env.local --import tsx scripts/pay-inspect.ts 7904409386496322304805
```

Los comandos de pagos terminan con código distinto de cero si no se obtuvo la aprobación esperada; un 502 guardado no cuenta como prueba aprobada. Los informes se guardan en `.private/`. No inician ni detienen Next.js.

La ruta `/api/pay/diagnostic` está restringida a desarrollo local, origen correcto y una sesión demo nueva. No forma parte del botón normal de pago ni funciona como alternativa automática ante un fallo de 3D Secure. Si autoriza, guarda `authorized`, sin comprobante de pago ni captura/aviso al Portal.

Referencias: [setup con Microform](https://developer.cybersource.com/docs/cybs/en-us/payer-authentication/developer/all/rest/payer-auth/pa2-use-tokens-flex/pa2-use-token-flex-setup-intro.html), [recolección del dispositivo](https://developer.cybersource.com/docs/cybs/en-us/payer-authentication/developer/all/rest/payer-auth/pa2-ccdc-ddc-intro.html) y [guía REST de Payer Authentication](https://developer.cybersource.com/docs/cybs/en-us/payer-authentication/developer/all/rest/payer-auth.html).

## Tablas creadas

| Tabla | Datos |
| --- | --- |
| `pay_sessions` | Cliente, bodega, pedido/factura de ensayo, monto, moneda, acceso y estado |
| `pay_attempts` | Intentos, referencia única, respuesta normalizada e ID de transacción |
| `pay_gateway_credentials` | Credenciales cifradas; sin claves maestras |
| `portal_deliveries` | Entregas pendientes, excluyendo demostraciones |
| `pay_audit_events` | Eventos administrativos sin secretos |

La conexión PostgreSQL usa TLS con validación de certificado. Los secretos no utilizan nombres `NEXT_PUBLIC_*` y no se devuelven en las rutas del navegador.

## Alcance y pendientes

Una autorización sandbox no es un cargo bancario real ni una factura fiscal pagada. La captura de tarjeta utiliza Microform v2 y el servidor verifica el token contra el contexto de esa sesión. Un resultado incierto bloquea nuevos intentos hasta conciliarlo; no se fabrica un comprobante.

El setup, la recolección del dispositivo, las etapas de autenticación y la recuperación tras recargar están implementados. La aprobación del pago, anulación y conciliación completa con el Portal/Storeganise siguen pendientes. El contrato del webhook del Portal y el de `billing.*` requieren el código/documentación de esas instalaciones antes de habilitarse. Las notificaciones al Portal están desactivadas por defecto y no admiten su dominio de producción desde sandbox.

No subas `.env.local` ni `.private/` al repositorio. Para trasladar el proyecto a otro servidor, configura allí `DATABASE_URL`, la misma clave de descifrado y las demás variables privadas. Crea nuevas llaves si necesitas sustituir las ya compartidas.
