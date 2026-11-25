ALTER TABLE pedidos_despacho ADD COLUMN whatsapp_preparado_en TEXT;

DROP TRIGGER IF EXISTS generar_aviso_whatsapp;

CREATE TRIGGER generar_aviso_whatsapp
AFTER UPDATE OF despachado_en ON pedidos_despacho
WHEN OLD.despachado_en IS NULL AND NEW.despachado_en IS NOT NULL
  AND NEW.notificar_whatsapp = 1 AND NEW.whatsapp_preparado_en IS NULL
BEGIN
  INSERT INTO avisos_whatsapp (pedido_id) VALUES (NEW.id) ON CONFLICT (pedido_id) DO NOTHING;
END;
