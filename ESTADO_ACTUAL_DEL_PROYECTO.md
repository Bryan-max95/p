# Estado del proyecto — 13 de octubre de 2026

Código incorporado: sesión por factura/cliente/bodega, entrada firmada desde Storeganise, importes obtenidos del servidor, visualización USD y cargo HNL con BCH, pago por tarjeta con 3DS, cola persistente para registrar el pago en Storeganise y comprobación de ocupación de la bodega. Pay no se comunica directamente con el portal fiscal.

La confirmación distingue entre cobro confirmado, pago aplicado en Storeganise y bodega habilitada. Si hay una escritura incierta o falta completar la entrada, informa el estado pendiente y no solicita otro pago.

Configuración local conservada: CyberSource sandbox y formulario manual. No se ejecutaron pruebas, compilación, servidor, cobros ni cambios remotos durante esta actualización.

Pendientes externos: desplegar variables/dominio/base, instalar el handoff de Storeganise después de emitir la factura, configurar firma/webhooks/permisos/método tarjeta/automatizaciones y validar el recorrido cuando el comercio lo autorice. No está acreditado todavía como operación de producción completa.

Detalles: [DESPLIEGUE_GITHUB_VERCEL.md](DESPLIEGUE_GITHUB_VERCEL.md) y [CONFIGURACION_STOREGANISE.md](CONFIGURACION_STOREGANISE.md).

