# Precio en USD y cobro en lempiras

Actualización: 9 de octubre de 2026.

El monto original recibido por el servidor se conserva en USD. El carrusel muestra ese precio, por ejemplo **USD 199.00**, y BAC/CyberSource recibe exclusivamente el importe convertido y `currency: HNL`. Antes de confirmar se informa el débito exacto en lempiras, la tasa y su fecha. El recibo conserva ambos importes.

## Fuente y acceso

Se utiliza el tipo de cambio de referencia (TCR) del BCH, indicador **97 / EC-TCR-01**, sin margen adicional. No es una cotización comercial de venta de BAC. La fuente oficial y el formato de la serie están publicados en el [portal de desarrolladores del BCH](https://bchapi-am.developer.azure-api.net/).

El titular debe registrarse y suscribirse allí. Guardar su clave de suscripción en el servidor:

```dotenv
BCH_API_KEY=
BCH_API_URL=https://bchapi-am.azure-api.net/api/v1/indicadores/97/cifras
BCH_INDICADOR_ID=97
```

En local: `.env.local`. En Vercel: variable privada del proyecto. No publicar la clave en GitHub ni usar `NEXT_PUBLIC_`.

El cliente consulta `https://bchapi-am.azure-api.net/api/v1/indicadores/97/cifras`. La respuesta real de autenticación del servidor especifica el encabezado **`clave`**, que se utiliza para enviar la suscripción. Se verificó una consulta autenticada con HTTP 200 usando las variables guardadas en `.env.local`. La URL y el indicador configurados se validan para consultar únicamente la serie oficial TCR 97.

La respuesta real contiene un arreglo con fechas como `2026-10-07T00:00:00`, sin sufijo de zona horaria. El lector acepta ese formato y el formato con `Z` del ejemplo público, conserva el día publicado y no lo desplaza según la zona horaria del servidor. Los registros duplicados con la misma tasa son válidos; las tasas contradictorias para la fecha seleccionada se rechazan.

```powershell
pnpm pay:bch-check
```

Este comando consulta únicamente el BCH e informa la tasa/fecha y una conversión de ejemplo. No crea sesiones ni pagos. La verificación del 9 de octubre de 2026 fue satisfactoria: último dato aplicable recibido **7 de octubre de 2026**, **L 26.8883 por USD 1**; USD 199.00 se convierten en **L 5350.77**. Esta es evidencia de esa consulta, no una tasa fija configurada.

## Reglas implementadas

- Conversión en el servidor: USD × TCR, con aritmética decimal entera y redondeo de medio centavo hacia arriba una sola vez.
- Se selecciona el registro aplicable más reciente usando la fecha de Honduras. Se ignoran publicaciones de fechas futuras y se rechazan tasas inválidas, contradictorias o de más de cuatro días calendario. Ese límite permite fines de semana/feriados cortos; un cierre más largo bloquea nuevas cotizaciones hasta disponer de un dato aceptable.
- Caché compartida en PostgreSQL, con actualización al crear un checkout si pasó una hora. Un bloqueo de base de datos evita consultas simultáneas duplicadas entre instancias de Vercel. No es un monitor periódico independiente del tráfico.
- Si la caché venció y BCH falla, no se crea un nuevo cobro en USD. No se usa la antigua variable manual `PAY_USD_HNL_RATE`, una tasa inventada ni una fuente de terceros.
- Cada sesión guarda USD original, HNL a cobrar, tasa, fuente, fecha del dato y hora de consulta. Dura 30 minutos para iniciar el pago. Los reintentos del mismo evento reutilizan la sesión y no renuevan su tasa ni su vencimiento.
- El inicio del pago comprueba que USD × tasa coincida con el HNL persistido. Autenticación y autorización usan ese HNL del servidor. No se aceptan importes ni tasas enviados por el formulario.
- Los registros y recibos anteriores permanecen con sus importes históricos. Las pruebas BAC por L100/L150/L200 siguen disponibles mediante `?scenario=hnl100`, `hnl150` y `hnl200`. La demo predeterminada ahora es `usd199` y requiere BCH configurado.

Las nuevas columnas y la caché se crean de forma aditiva en `lib/pay/schema.ts` al inicializar la aplicación. La migración se aplicó a la base configurada durante esta revisión, sin crear pagos ni alterar montos históricos.

## Comprobaciones

```powershell
pnpm typecheck
node --import tsx --test tests/*.test.ts
pnpm build
# Con el servidor local iniciado: prueba visual con respuestas simuladas, sin pagos.
node --env-file=.env.local --import tsx scripts/pay-currency-ui-check.ts
```

Las pruebas automatizadas cubren precisión, vigencia, fallos del BCH, aislamiento entre clientes, concurrencia del mismo evento, tasa persistida, recibos y rechazo de importes alterados. Las pruebas visuales usan una tasa simulada explícitamente identificada en el concepto; no acreditan una cotización BCH real ni un pago bancario nuevo.

Resultado de esta revisión: **32 pruebas automatizadas aprobadas**, TypeScript y ESLint de los archivos modificados sin errores, y `pnpm build` completado. La revisión visual pasó a 1280 y 390 píxeles en español e inglés, con cero solicitudes de pago. Capturas locales: `.private/currency-ui/`. Se corrigió el resumen móvil para evitar superposición del nombre y el precio. La compilación utiliza la salida estándar de Next.js; se retiró el empaquetado `standalone` que fallaba por permisos de enlaces simbólicos en Windows.

## Pendientes para producción

1. Copiar las tres variables BCH al entorno privado de Vercel y verificar la consulta desde el despliegue. La configuración y la consulta autenticada locales ya están comprobadas.
2. Secreto real de webhooks y contrato/API de Storeganise para recibir el checkout y registrar el pago **por tarjeta** contra la factura original en USD, guardando la referencia del cobro HNL. El cliente Admin implementado actualmente solo hace lecturas.
3. Completar la entrega persistente Pay → Storeganise y verificar el alquiler/bodega y el evento que Storeganise envía al Portal. El Portal se considera listo; no se modifica en este cambio.
4. Configurar y validar el perfil BAC/CyberSource de producción, Microform/3DS, sesiones, dominio, variables de Vercel y el recorrido completo.

La conversión no activa por sí sola producción ni la asignación de bodegas. El proyecto continúa restringido a sandbox hasta completar esa integración.
