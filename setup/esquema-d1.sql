CREATE TABLE IF NOT EXISTS pedidos_despacho (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  codigo TEXT GENERATED ALWAYS AS ('YIWU-' || printf('%06d', id)) STORED UNIQUE,
  solicitud TEXT NOT NULL UNIQUE,
  creado_en TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  agencia TEXT NOT NULL CHECK (length(agencia) BETWEEN 1 AND 120),
  departamento TEXT NOT NULL CHECK (length(departamento) BETWEEN 1 AND 40),
  direccion TEXT NOT NULL CHECK (length(direccion) BETWEEN 1 AND 300),
  nombre TEXT NOT NULL CHECK (length(nombre) BETWEEN 1 AND 120),
  dni TEXT NOT NULL CHECK (length(dni) = 8 AND dni NOT GLOB '*[^0-9]*'),
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
  ) VIRTUAL
);

CREATE INDEX IF NOT EXISTS pedidos_fecha ON pedidos_despacho (creado_en);
CREATE INDEX IF NOT EXISTS pedidos_estado ON pedidos_despacho (estado, id);
CREATE INDEX IF NOT EXISTS pedidos_departamento ON pedidos_despacho (departamento, id);

CREATE TABLE IF NOT EXISTS sesiones_panel (
  clave TEXT PRIMARY KEY NOT NULL,
  vence_en INTEGER NOT NULL
) WITHOUT ROWID;

CREATE INDEX IF NOT EXISTS sesiones_vencimiento ON sesiones_panel (vence_en);

CREATE TABLE IF NOT EXISTS intentos_panel (
  origen TEXT PRIMARY KEY NOT NULL,
  vence_en INTEGER NOT NULL,
  intentos INTEGER NOT NULL CHECK (intentos > 0)
) WITHOUT ROWID;

CREATE INDEX IF NOT EXISTS intentos_vencimiento ON intentos_panel (vence_en);
