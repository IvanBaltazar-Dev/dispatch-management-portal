# Dispatch Management Portal

Portal para registrar solicitudes de envío y organizar el despacho de pedidos. Implementado para YIWU Center con JavaScript, Cloudflare Pages y Cloudflare D1.

## Funcionalidades

- Registro de pedidos con búsqueda de agencias y enlace de confirmación por WhatsApp.
- Panel privado con filtros por destino, fecha y estado y carga progresiva de pedidos.
- Preparación por lotes, medidas de bultos y exportación Excel compatible con Shalom Pro.
- Eliminación de pedidos individuales o seleccionados, con confirmación previa.

## Publicación en Cloudflare Pages

| Ajuste | Valor |
| --- | --- |
| Framework preset | `None` |
| Production branch | `main` |
| Build command | `node scripts/build.mjs` |
| Build output directory | `dist` |

Ejecuta `setup/esquema-d1.sql` al crear la base D1. Antes de publicar el panel, aplica `setup/avisos-whatsapp-d1.sql` y luego `setup/confirmacion-whatsapp-d1.sql` en esa base. Aplica cada migración una sola vez y conecta la base al proyecto con el nombre `DB`.

El formulario viene con el WhatsApp del asesor de YIWU configurado en el enlace de ayuda. Para cambiarlo, define `YIWU_WHATSAPP_NUMBER` como texto en formato internacional en **Variables and Secrets**. El formulario usa el número de esa variable al guardar el pedido y la compilación lo usa para el enlace de ayuda. Registra `YIWU_OWNER_USERNAME` como texto con el nombre de usuario del panel. Si omites esta variable, el usuario es `yiwu`.

Ejecuta `setup/generar-acceso-panel.ps1` en PowerShell y registra el resultado `YIWU_OWNER_PASSWORD_HASH` como secreto de Cloudflare. Usa el parámetro `-ClavePropia` si prefieres escribir una contraseña de tu elección. Despliega de nuevo para aplicar la configuración.

## Aviso de despacho por WhatsApp

Al confirmar un envío individual, el panel guarda el despacho y abre WhatsApp en el chat del celular registrado, con el mensaje escrito. El asesor pulsa **Enviar** en WhatsApp. El panel guarda el estado **Mensaje listo en WhatsApp** y permite abrir el mismo mensaje con **Volver a confirmar envío**.

### Aviso automático de envíos en lote

1. En WhatsApp Manager crea la plantilla `pedido_en_shalom` como **Utilidad**, en español (`es`), con cabecera de tipo **Imagen**. Usa `site/aviso-despacho-shalom.jpg` como muestra y selecciona variables por número. El cuerpo es `Tu pedido {{1}} ya está en Shalom y está listo para ser enviado. Gracias por tu compra en YIWU Center.` Usa un código de ejemplo como `YIWU-000001` y espera la aprobación de Meta. [Documentación de Meta para plantillas con imagen](https://www.postman.com/meta/whatsapp-business-platform/request/2qbotrb/send-message-template-media)
2. En `avisos-whatsapp/wrangler.jsonc`, configura el ID de la misma base D1 del panel, el **Phone Number ID** de WhatsApp Cloud API y la URL pública HTTPS de `/aviso-despacho-shalom.jpg` en Pages. La URL debe servir el JPEG sin autenticación.
3. Despliega el Worker con `npx wrangler deploy --config avisos-whatsapp/wrangler.jsonc`. Guarda el token con permiso `whatsapp_business_messaging` como secreto ejecutando `npx wrangler secret put WA_SHIPMENT_ACCESS_TOKEN --config avisos-whatsapp/wrangler.jsonc`.
4. Verifica con un pedido de prueba y un número autorizado. Marca el pedido como enviado, espera a que el Worker procese el aviso y actualiza el panel. Comprueba que la imagen llegue al chat de prueba.

Marcar un lote como enviado programa un aviso por cada pedido con autorización registrada. El Worker revisa los pendientes cada minuto. Si Meta rechaza un aviso, el panel permite reintentarlo después de corregir la causa. Si se pierde la respuesta, el panel indica que el envío quedó sin confirmar.

## Desarrollo

Edita el código en `site/` y ejecuta `node scripts/build.mjs` con Node.js 22 o superior para generar la publicación. Los archivos de `dist/` se generan en cada despliegue.

La lista de archivos permitidos en `.gitignore` también define qué recursos de `site/` se publican. Agrega a esa lista cada archivo nuevo que deba formar parte del sitio.

Ejecuta `node --test avisos-whatsapp/worker.test.mjs` para probar la integración con SQLite y respuestas simuladas de Meta.
