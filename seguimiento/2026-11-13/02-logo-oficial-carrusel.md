# Logo oficial dentro de los carruseles

Fecha local: 2026-11-13, America/Chicago.

## Pedido

Usar el logo proporcionado por el usuario como imagen de la empresa, mostrarlo únicamente dentro del carrusel y con tamaño adecuado.

## Qué se hizo

- Se localizó el PNG exacto aportado, `loco-self-storage.png`, y se conservó sin redibujarlo ni modificar sus píxeles en `public/roatan-self-storage-logo.png`.
- La imagen tiene 490 × 509 píxeles y transparencia. El SHA256 del original y de la copia coincide: `675C654590A58087D00B9F397629DFB9D067030BF1BA07CD2009B475BB2E1321`.
- Se creó `app/components/company-logo.tsx` como componente compartido para usar este archivo oficial en los carruseles de pago (reservas y facturas) y de añadir tarjeta.
- Se coloca una sola vez dentro de cada recuadro del carrusel, sobre los pasos, centrado sobre fondo blanco. Tiene 128 px de ancho en móvil y 160 px desde 640 px de pantalla, con altura automática para conservar su proporción.
- Se retiraron el logo anterior del encabezado exterior y la marca de agua dibujada en la tarjeta, evitando repeticiones del logo dentro de esas vistas.
- La compilación inicial detectó archivos TypeScript de copias locales de entrega. Se excluyeron `entregas/` y `respaldos/` en `tsconfig.json` para que esas copias no se compilen como parte de la aplicación.

## Respaldo y archivos

Respaldo previo: `respaldos/2026-11-13/antes-logo-carrusel/`, con los dos componentes anteriores, el índice de seguimiento y `tsconfig.json`.

Archivos de aplicación:

- Nuevo: `public/roatan-self-storage-logo.png`.
- Nuevo: `app/components/company-logo.tsx`.
- Modificados: `app/components/payment-carousel.tsx`, `app/components/payment-method-carousel.tsx` y `tsconfig.json`.
- Seguimiento: esta nota y `seguimiento/README.md`.

Se preserva la copia `public/loco-self-storage.png` encontrada localmente. La referencia estable usada por el componente es `public/roatan-self-storage-logo.png`.

## Verificaciones

- Inspección de la imagen original y comparación SHA256 correctas.
- Lint dirigido de los tres componentes correcto.
- Compilación de producción y comprobación de TypeScript correctas después de excluir las copias locales. Se mantuvieron los avisos de caché de Webpack sin impedir la compilación.
- Revisión en Microsoft Edge sin interfaz, contra la aplicación compilada y con sesiones simuladas: los dos carruseles se muestran sin desbordamiento horizontal a 390 y 1440 px de pantalla. El logo aparece una sola vez, dentro de `card-payment-carousel`, tanto en el primer paso como al entrar a datos de tarjeta.
- Medidas comprobadas: 128 × 133 px en móvil y 160 × 166,25 px en escritorio, conservando la proporción original. Las capturas locales se inspeccionaron; las imágenes externas se bloquearon durante esa revisión.
- `git diff --check` correcto. No se añadieron pruebas unitarias para este cambio visual.
- No se hicieron cobros, registros bancarios ni modificaciones de facturas.

## Estado y siguiente paso

Validación visual terminada. Pendiente registrar la subida a GitHub del cambio. No se modificó ni publicó la etiqueta de GTM. El despliegue de producción se confirmará por separado de la subida del código.
