# Publicar Pay en GitHub y Vercel

Actualización del 13 de octubre de 2026: código preparado para desplegar y configurar. No se ejecutaron pruebas ni compilación de esta actualización. No se ha publicado desde esta sesión.

## GitHub

Subir los archivos fuente, pnpm-lock.yaml, vercel.json y la documentación mediante Git respetando .gitignore. No incluir .env.local, .private, node_modules ni las carpetas .next. La plantilla .env.example solo contiene nombres y valores de ejemplo. El repositorio/remoto debe ser el elegido por el comercio.

## Vercel

1. Importar el repositorio como Next.js y seleccionar la carpeta de package.json.
2. Instalación: pnpm install --frozen-lockfile. Compilación: pnpm build. No colocar pruebas bancarias ni pay:setup en el comando de compilación.
3. Usar la detección de salida de Next.js. next.config.ts utiliza .next, según el ajuste del comercio para Vercel.
4. Copiar las variables privadas a Vercel. .env.local no se transfiere desde GitHub.
5. Configurar el dominio payroatanselfstorage.com y PAY_PUBLIC_URL con el origen HTTPS exacto. Volver a desplegar cuando cambien las variables.

| Grupo | Variables |
| --- | --- |
| Base y sesión | DATABASE_URL, PAY_PUBLIC_URL, PAY_SESSION_TOKEN_SECRET |
| Mantenimiento | CRON_SECRET (mínimo 32 caracteres); PAY_RETRY_SECRET opcional para compatibilidad |
| Banco | CYBERSOURCE_ENVIRONMENT, CYBERSOURCE_MERCHANT_ID, CYBERSOURCE_KEY_ID, CYBERSOURCE_SHARED_SECRET |
| Cambio | BCH_API_KEY, BCH_API_URL, BCH_INDICADOR_ID |
| Storeganise | STOREGANISE_PAY_ENABLED, STOREGANISE_API_URL, STOREGANISE_API_KEY, STOREGANISE_WEBHOOK_SECRET |
| Registro y entrada | STOREGANISE_CARD_PAYMENT_METHOD=card, STOREGANISE_COMPLETE_PAID_INVOICE_STEP=true |

Todas son variables privadas del servidor, sin prefijo NEXT_PUBLIC_. PostgreSQL requiere TLS válido y permisos para las migraciones aditivas de lib/pay/schema.ts, que se aplican al primer acceso. El código no elimina los registros anteriores.

Para el formulario manual de sandbox:

    CYBERSOURCE_ENVIRONMENT=sandbox
    PAY_SANDBOX_MANUAL_ENABLED=true
    PAY_DEMO_ENABLED=false
    STOREGANISE_PAY_ENABLED=false
    STOREGANISE_TEST_CUSTOMER_IDS=manual-sandbox-customer

Para el recorrido Storeganise real, cuando corresponda habilitarlo:

    CYBERSOURCE_ENVIRONMENT=production
    PAY_SANDBOX_MANUAL_ENABLED=false
    PAY_DEMO_ENABLED=false
    STOREGANISE_PAY_ENABLED=true
    STOREGANISE_API_URL=https://roatanselfstorage.storeganise.com/api/v1/admin
    STOREGANISE_CARD_PAYMENT_METHOD=card
    STOREGANISE_COMPLETE_PAID_INVOICE_STEP=true

Se conservan las credenciales BAC existentes; el código selecciona api.cybersource.com con production. Cambiar el host no confirma que el banco haya habilitado el acceso. La configuración local no se cambió de sandbox en esta actualización.

## Recuperación de pendientes

Después de confirmar un cobro, Pay programa la entrega a Storeganise. La pantalla de confirmación consulta el estado periódicamente y despierta entregas pendientes; los webhooks también las despiertan.

vercel.json añade un respaldo diario a /api/internal/reconcile a las 06:00 UTC. CRON_SECRET autentica esa tarea. La ruta solo consulta transacciones bancarias existentes, recupera intentos interrumpidos y procesa la cola de Storeganise; no crea cargos de tarjeta.

Cada ejecución procesa lotes pequeños. El respaldo diario no ofrece recuperación inmediata cuando el cliente ya cerró la página. Para operación continua, programar esa ruta cada minuto con un plan que lo permita o con un programador externo autenticado mediante Authorization: Bearer CRON_SECRET. También existe POST/GET /api/internal/storeganise-sync para procesar exclusivamente Storeganise.

## Conexión externa pendiente

Seguir [CONFIGURACION_STOREGANISE.md](CONFIGURACION_STOREGANISE.md): redirección después de emitir la factura, firma, método tarjeta y automatizaciones de entrada. Publicar Pay no cambia la configuración de Storeganise ni conecta por sí mismo su botón de pago.

Las pruebas y aprobaciones históricas corresponden a otras revisiones. No atribuir esos resultados a este código sin validarlo. La última comprobación de producción documentada anteriormente devolvió HTTP 401; no se repitió en esta actualización.

