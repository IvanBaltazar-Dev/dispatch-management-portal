ALTER TABLE pedidos_despacho ADD COLUMN notificar_whatsapp INTEGER NOT NULL DEFAULT 0
  CHECK (notificar_whatsapp IN (0, 1));

CREATE TABLE IF NOT EXISTS avisos_whatsapp (
  pedido_id INTEGER PRIMARY KEY REFERENCES pedidos_despacho (id) ON DELETE CASCADE,
  estado TEXT NOT NULL DEFAULT 'pendiente'
    CHECK (estado IN ('pendiente', 'procesando', 'aceptado', 'error', 'incierto')),
  intentos INTEGER NOT NULL DEFAULT 0,
  proximo_intento INTEGER NOT NULL DEFAULT 0,
  meta_id TEXT,
  error_codigo TEXT
);

CREATE INDEX IF NOT EXISTS avisos_whatsapp_pendientes ON avisos_whatsapp (estado, proximo_intento, pedido_id);

CREATE TRIGGER IF NOT EXISTS generar_aviso_whatsapp
AFTER UPDATE OF despachado_en ON pedidos_despacho
WHEN OLD.despachado_en IS NULL AND NEW.despachado_en IS NOT NULL AND NEW.notificar_whatsapp = 1
BEGIN
  INSERT INTO avisos_whatsapp (pedido_id) VALUES (NEW.id) ON CONFLICT (pedido_id) DO NOTHING;
END;
