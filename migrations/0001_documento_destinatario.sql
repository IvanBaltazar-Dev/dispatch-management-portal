CREATE TABLE pedidos_despacho_nuevo (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  codigo TEXT GENERATED ALWAYS AS ('YIWU-' || printf('%06d', id)) STORED UNIQUE,
  solicitud TEXT NOT NULL UNIQUE,
  creado_en TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  agencia TEXT NOT NULL CHECK (length(agencia) BETWEEN 1 AND 120),
  departamento TEXT NOT NULL CHECK (length(departamento) BETWEEN 1 AND 40),
  direccion TEXT NOT NULL CHECK (length(direccion) BETWEEN 1 AND 300),
  nombre TEXT NOT NULL CHECK (length(nombre) BETWEEN 1 AND 120),
  dni TEXT NOT NULL CHECK (length(dni) IN (8, 9, 11) AND dni NOT GLOB '*[^0-9]*'),
  celular TEXT NOT NULL CHECK (length(celular) = 9 AND celular GLOB '9*' AND celular NOT GLOB '*[^0-9]*'),
  busqueda TEXT NOT NULL,
  shalom_mercaderia TEXT,
  shalom_cantidad INTEGER CHECK (shalom_cantidad BETWEEN 1 AND 2147483647),
  shalom_contacto_doc TEXT,
  shalom_contacto_telefono TEXT,
  shalom_grr TEXT,
  shalom_medidas TEXT CHECK (shalom_medidas IS NULL OR json_array_length(shalom_medidas) = 4),
  shalom_bultos TEXT CHECK (shalom_bultos IS NULL OR json_type(shalom_bultos) = 'array'),
  despachado_en TEXT CHECK (despachado_en IS NULL OR (shalom_mercaderia IS NOT NULL AND shalom_cantidad IS NOT NULL)),
  estado TEXT GENERATED ALWAYS AS (
    CASE WHEN despachado_en IS NOT NULL THEN 'enviado'
      WHEN shalom_mercaderia IS NOT NULL AND shalom_cantidad IS NOT NULL THEN 'preparado'
      ELSE 'recibido' END
  ) VIRTUAL,
  notificar_whatsapp INTEGER NOT NULL DEFAULT 0 CHECK (notificar_whatsapp IN (0, 1)),
  whatsapp_preparado_en TEXT
);

INSERT INTO pedidos_despacho_nuevo (
  id, solicitud, creado_en, agencia, departamento, direccion, nombre, dni, celular, busqueda,
  shalom_mercaderia, shalom_cantidad, shalom_contacto_doc, shalom_contacto_telefono, shalom_grr,
  shalom_medidas, shalom_bultos, despachado_en, notificar_whatsapp, whatsapp_preparado_en
)
SELECT id, solicitud, creado_en, agencia, departamento, direccion, nombre, dni, celular, busqueda,
  shalom_mercaderia, shalom_cantidad, shalom_contacto_doc, shalom_contacto_telefono, shalom_grr,
  shalom_medidas, shalom_bultos, despachado_en, notificar_whatsapp, whatsapp_preparado_en
FROM pedidos_despacho;

-- Conserva la secuencia de códigos aunque se haya eliminado el último pedido.
DELETE FROM sqlite_sequence WHERE name = 'pedidos_despacho_nuevo';
INSERT INTO sqlite_sequence (name, seq)
SELECT 'pedidos_despacho_nuevo', seq FROM sqlite_sequence WHERE name = 'pedidos_despacho';

-- Conserva los avisos relacionados al reemplazar las tablas con borrado en cascada.
CREATE TABLE avisos_whatsapp_nuevo (
  pedido_id INTEGER PRIMARY KEY REFERENCES pedidos_despacho_nuevo (id) ON DELETE CASCADE,
  estado TEXT NOT NULL DEFAULT 'pendiente'
    CHECK (estado IN ('pendiente', 'procesando', 'aceptado', 'error', 'incierto')),
  intentos INTEGER NOT NULL DEFAULT 0,
  proximo_intento INTEGER NOT NULL DEFAULT 0,
  meta_id TEXT,
  error_codigo TEXT
);

INSERT INTO avisos_whatsapp_nuevo (pedido_id, estado, intentos, proximo_intento, meta_id, error_codigo)
SELECT pedido_id, estado, intentos, proximo_intento, meta_id, error_codigo FROM avisos_whatsapp;

DROP TRIGGER generar_aviso_whatsapp;
DROP TABLE avisos_whatsapp;
DROP TABLE pedidos_despacho;
ALTER TABLE pedidos_despacho_nuevo RENAME TO pedidos_despacho;
ALTER TABLE avisos_whatsapp_nuevo RENAME TO avisos_whatsapp;

CREATE INDEX pedidos_fecha ON pedidos_despacho (creado_en);
CREATE INDEX pedidos_estado ON pedidos_despacho (estado, id);
CREATE INDEX pedidos_departamento ON pedidos_despacho (departamento, id);
CREATE INDEX avisos_whatsapp_pendientes ON avisos_whatsapp (estado, proximo_intento, pedido_id);

CREATE TRIGGER generar_aviso_whatsapp
AFTER UPDATE OF despachado_en ON pedidos_despacho
WHEN OLD.despachado_en IS NULL AND NEW.despachado_en IS NOT NULL
  AND NEW.notificar_whatsapp = 1 AND NEW.whatsapp_preparado_en IS NULL
BEGIN
  INSERT INTO avisos_whatsapp (pedido_id) VALUES (NEW.id) ON CONFLICT (pedido_id) DO NOTHING;
END;
