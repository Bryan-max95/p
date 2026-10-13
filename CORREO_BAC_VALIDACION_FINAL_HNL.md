**Asunto: Validación de pruebas en lempiras y siguientes pasos para abonos a la cuenta de Roatan Self Storage**

Estimado equipo de BAC Credomatic:

Les informamos que ya implementamos el cambio de moneda de cobro a **lempiras hondureños (HNL)** en la integración de pagos de Roatan Self Storage.

El 2 de octubre realizamos tres pruebas con Visa en el ambiente sandbox, por **L100.00, L150.00 y L200.00**. Las tres completaron correctamente la autenticación 3D Secure y obtuvieron autorización aprobada. La consulta posterior en CyberSource confirmó los importes en HNL y resultados exitosos para autorización y captura (`ics_auth` e `ics_bill`, ambos con `SOK / 100`). El error observado anteriormente en las pruebas en dólares no se presentó en estos casos.

Para que puedan verificar los resultados, compartimos los identificadores:

| Importe | Request ID |
| --- | --- |
| L100.00 | `7909816558806877804805` |
| L150.00 | `7909816667866888504805` |
| L200.00 | `7909816773816160904806` |

**Organization ID sandbox:** `test_bac_hn_bodegsegurasroatan`.

Con el cambio a lempiras implementado y estos resultados satisfactorios, queremos avanzar a la integración final del carrusel de pago en nuestra plataforma. Agradeceremos que revisen las transacciones y nos confirmen si todo está correctamente configurado para continuar.

En particular, necesitamos su orientación sobre la fase final para que, una vez habilitada la operación en producción, **los pagos de los clientes se abonen a la cuenta bancaria de la empresa**:

1. ¿Pueden confirmar que los resultados cumplen sus requisitos o indicarnos qué pruebas adicionales faltan?
2. ¿La afiliación del comercio y la cuenta bancaria a nombre de la empresa están correctamente vinculadas para recibir las liquidaciones de los pagos en HNL? Si falta algún trámite o documento, agradeceremos que nos lo indiquen.
3. ¿Qué credenciales, identificadores o habilitaciones de producción deben proporcionarnos o gestionar para completar esta etapa?
4. ¿Cuál sería el procedimiento de validación final y cuáles son los plazos de abono a la cuenta de la empresa?

Las operaciones indicadas corresponden exclusivamente a sandbox. Solicitamos su confirmación de los pasos pendientes para pasar a producción y verificar el flujo completo, desde el pago del cliente hasta el abono en la cuenta empresarial.

Quedamos atentos a su revisión y disponibles para coordinar una sesión técnica si lo consideran necesario.

Saludos cordiales,

**[Nombre y apellido]**  
**[Cargo / Empresa]**  
**Proyecto Roatan Self Storage**  
**[Teléfono de contacto]**
