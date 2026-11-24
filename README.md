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

Ejecuta `setup/esquema-d1.sql` en la consola de la base D1 y conéctala al proyecto con el nombre `DB`.

En **Variables and Secrets**, registra `YIWU_WHATSAPP_NUMBER` como texto en formato internacional. El mismo valor se usa para el enlace de ayuda y para abrir el chat al guardar el pedido. Registra `YIWU_OWNER_USERNAME` como texto con el nombre de usuario del panel. Si omites esta variable, el usuario es `yiwu`.

Ejecuta `setup/generar-acceso-panel.ps1` en PowerShell y registra el resultado `YIWU_OWNER_PASSWORD_HASH` como secreto de Cloudflare. Usa el parámetro `-ClavePropia` si prefieres escribir una contraseña de tu elección. Despliega de nuevo para aplicar la configuración.

## Desarrollo

Edita el código en `site/` y ejecuta `node scripts/build.mjs` con Node.js 22 o superior para generar la publicación. Los archivos de `dist/` se generan en cada despliegue.

La lista de archivos permitidos en `.gitignore` también define qué recursos de `site/` se publican. Agrega a esa lista cada archivo nuevo que deba formar parte del sitio.
