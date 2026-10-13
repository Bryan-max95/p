# Credenciales activas de CyberSource

La integración lee las mismas tres credenciales privadas existentes de BAC para el endpoint seleccionado. La configuración local activa apunta a producción:

```ini
CYBERSOURCE_ENVIRONMENT=production
CYBERSOURCE_MERCHANT_ID=<Merchant ID existente>
CYBERSOURCE_KEY_ID=<Key proporcionado por el comercio>
CYBERSOURCE_SHARED_SECRET=<Shared Secret proporcionado por el comercio>
```

En localhost, los valores existentes están en `.env.local`, excluido del control de versiones. En un despliegue se configuran como variables privadas del servidor, sin prefijo `NEXT_PUBLIC_`. Los ejemplos anteriores son marcadores; no contienen secretos.

No se requieren variables duplicadas con prefijo `CYBERSOURCE_PRODUCTION_`. Los valores de las tres credenciales originales se conservaron. La aplicación no deduce permisos a partir del nombre del Merchant ID: el proveedor valida la autenticación en el endpoint seleccionado.

`lib/pay/credentials.ts` valida el formato de las tres variables antes de firmar una solicitud. Si falta alguna o no cumple su formato, rechaza la operación. Esta validación local no confirma permisos del banco. No consulta credenciales en Neon. Los registros cifrados antiguos de la base de datos no se utilizan ni se borran con este cambio.

`pay:setup` conserva las tres variables; ya no importa credenciales a Neon ni elimina el Key o el Shared Secret del archivo local. Neon continúa almacenando sesiones, intentos y resultados de pago. Las claves de seguridad de sesiones y avisos al Portal tienen funciones distintas de las credenciales de CyberSource.

El modo sandbox usa `https://apitest.cybersource.com`; producción usa `https://api.cybersource.com`. Microform, verificación de claves públicas, Cardinal/3DS y CSP cambian conjuntamente según el entorno. El Merchant ID se envía como `v-c-merchant-id`; el Key y Shared Secret firman la solicitud desde el servidor.

Las nuevas pruebas del 9 de octubre por L100, L200 y L1,000 fueron aprobadas en sandbox con estas credenciales, sin el error anterior de `merchant_id`.

La comprobación real posterior en producción (`pnpm pay:production-check --live`, 17:27:11 UTC) recibió **HTTP 401: autenticación rechazada** al solicitar un contexto Microform. No se inició ningún cobro real. BAC debe revisar la habilitación/validez de las credenciales en producción. El endpoint está configurado, pero su funcionamiento bancario no está verificado. Instrucciones y evidencia: [PRODUCCION_Y_COBROS_MANUALES.md](PRODUCCION_Y_COBROS_MANUALES.md).

Después de esa consulta, el comercio indicó que producción se probará únicamente de forma manual desde el carrusel. Se retiró la opción `--live`; `pay:production-check` solo revisa variables locales y `pay:check` rechaza el entorno de producción. No se ha repetido ninguna consulta al banco.
