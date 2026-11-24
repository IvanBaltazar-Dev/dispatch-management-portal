const maxBodyBytes = 4096;
const maxBatchBytes = 131072;
const maxExportBytes = 98304;
const maxBatchOrders = 100;
const orderCode = /^YIWU-\d{6,}$/;
const requestId = /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i;
const fullName = /^\p{L}[\p{L}\p{M}.'’\-]*(?: \p{L}[\p{L}\p{M}.'’\-]*)+$/u;
const cleanText = value => typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
const ownerCookie = '__Host-yiwu_owner';
const sessionSeconds = 3600;
const attemptSeconds = 900;
const maxLoginAttempts = 8;
const encodedDigest = /^[A-Za-z0-9_-]{43}$/;
const limaDate = new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Lima', dateStyle: 'short' });
const orderColumns = 'id,codigo,creado_en,agencia,departamento,direccion,nombre,dni,celular,shalom_mercaderia,shalom_cantidad,shalom_contacto_doc,shalom_contacto_telefono,shalom_grr,shalom_medidas,shalom_bultos,despachado_en';
const orderPageSizes = ['25', '50', '100'];
const orderStages = ['recibido', 'preparado', 'enviado'];
const orderPeriods = ['hoy', 'ayer', 'semana', 'rango'];
const normalizeAgency = name => name.toUpperCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/[^A-Z0-9]+/g, ' ').trim();

function json(body, status = 200, headers = {}) {
  return Response.json(body, { status, headers: { ...headers, 'Cache-Control': 'no-store' } });
}

async function readJson(request, maxBytes = maxBodyBytes) {
  const reader = request.body?.getReader();
  if (!reader) return null;

  const bytes = new Uint8Array(maxBytes);
  let length = 0;
  try {
    for (let next = await reader.read(); !next.done; next = await reader.read()) {
      if (length + next.value.length > maxBytes) {
        await reader.cancel();
        return null;
      }
      bytes.set(next.value, length);
      length += next.value.length;
    }
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, length)));
  } catch {
    return null;
  } finally {
    reader.releaseLock();
  }
}

async function customerCatalog(env, pageUrl) {
  const response = await env.ASSETS.fetch(new URL('/yiwu-agencias-shalom.js', pageUrl));
  if (!response.ok) throw new Error('No se pudo cargar el catálogo');
  const source = await response.text();
  // El catálogo público asigna un objeto JSON a window.yiwuShalomAgencies.
  return JSON.parse(source.slice(source.indexOf('{'), source.lastIndexOf('}') + 1));
}

async function catalogContainsOrder(env, pageUrl, order) {
  const catalog = await customerCatalog(env, pageUrl);
  if (!Object.hasOwn(catalog, order.departamento)) return false;
  return catalog[order.departamento].some(([name, address, proName]) =>
    Boolean(proName) && cleanText(name) === order.agencia && cleanText(address) === order.direccion
  );
}

async function panelCatalog(env, pageUrl) {
  const [directory, response] = await Promise.all([
    customerCatalog(env, pageUrl), env.ASSETS.fetch(new URL('/panel/shalom-catalogo.json', pageUrl)),
  ]);
  if (!response.ok) throw new Error('Catálogo de Shalom Pro no disponible');
  const { origenes, destinos, mercaderias, maximo } = await response.json();
  const proLabels = new Set(destinos);
  const branches = new Map();
  for (const [department, entries] of Object.entries(directory)) {
    const labels = new Map();
    for (const [name, , proName, detail = {}] of entries) {
      if (!proLabels.has(proName)) continue;
      const place = [...new Set([detail.distrito, detail.provincia, department].filter(Boolean))].join(' · ');
      labels.set(normalizeAgency(name), { name: cleanText(name), proName, place, search: normalizeAgency(`${name} ${place} ${proName}`) });
    }
    branches.set(department, labels);
  }

  return {
    origenes,
    mercaderias,
    maximo,
    departamentos: [...branches.keys()],
    agenciesMatching(query, department) {
      if (!query) return [];
      const terms = query.split(' ');
      return [...branches].flatMap(([region, labels]) => department && region !== department ? [] :
        [...labels.values()].filter(agency => terms.every(term => agency.search.includes(term))).map(agency => agency.name));
    },
    withDestination(order) {
      const key = normalizeAgency(order.agencia);
      const branch = branches.get(order.departamento)?.get(key);
      return {
        ...order,
        shalom_destino: branch?.proName ?? null,
        shalom_ubicacion: branch?.place ?? order.departamento,
        shalom_medidas: JSON.parse(order.shalom_medidas),
        shalom_bultos: JSON.parse(order.shalom_bultos),
      };
    },
  };
}

async function saveOrder(db, order) {
  const { solicitud, agencia, departamento, direccion, nombre, dni, celular } = order;
  const values = [solicitud, agencia, departamento, direccion, nombre, dni, celular];
  const written = await db.prepare(`
    INSERT INTO pedidos_despacho (solicitud, agencia, departamento, direccion, nombre, dni, celular, busqueda)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (solicitud) DO NOTHING RETURNING codigo
  `).bind(...values, normalizeAgency([nombre, agencia, departamento, direccion].join(' '))).first('codigo');
  if (written) return written;
  return db.prepare(`
    SELECT codigo FROM pedidos_despacho WHERE solicitud = ? AND agencia = ? AND departamento = ?
      AND direccion = ? AND nombre = ? AND dni = ? AND celular = ?
  `).bind(...values).first('codigo');
}

function ownerSessionCookie(token, age) {
  return `${ownerCookie}=${token}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=${age}`;
}

function ownerToken(request) {
  const prefix = `${ownerCookie}=`;
  const cookie = request.headers.get('Cookie')?.split(';').map(value => value.trim()).find(value => value.startsWith(prefix));
  const token = cookie?.slice(prefix.length);
  return encodedDigest.test(token ?? '') ? token : null;
}

function base64Url(bytes) {
  return btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

async function digest(text) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
}

async function sessionKey(verifier, token, ownerUsername) {
  const account = ownerUsername === 'yiwu' ? verifier : `${ownerUsername}:${verifier}`;
  return base64Url(await digest(`sesion:${account}:${token}`));
}

async function startOwnerSession(request, db, verifier, ownerUsername) {
  const data = await readJson(request);
  const usuario = cleanText(data?.usuario ?? data?.email);
  const password = data?.password;
  if (!usuario || usuario.length > 254 || typeof password !== 'string' || !password || password.length > 512) {
    return json({ error: 'Ingresa tu usuario y contraseña.' }, 400);
  }
  const now = Math.floor(Date.now() / 1000);
  const ip = request.headers.get('CF-Connecting-IP') ?? 'local';
  const origin = base64Url(await digest(`intentos:${verifier}:${ip}`));
  const count = await db.prepare('SELECT intentos FROM intentos_panel WHERE origen = ? AND vence_en > ?')
    .bind(origin, now).first('intentos');
  if (count >= maxLoginAttempts) return json({ error: 'Demasiados intentos. Vuelve a intentar en unos minutos.' }, 429);

  const correct = crypto.subtle.timingSafeEqual(
    new TextEncoder().encode(verifier), new TextEncoder().encode(base64Url(await digest(password)))
  );
  if (!correct || usuario.toLowerCase() !== ownerUsername) {
    await db.prepare(`
      INSERT INTO intentos_panel (origen, vence_en, intentos) VALUES (?, ?, 1)
      ON CONFLICT (origen) DO UPDATE SET
        intentos = CASE WHEN vence_en <= ? THEN 1 ELSE intentos + 1 END,
        vence_en = CASE WHEN vence_en <= ? THEN excluded.vence_en ELSE vence_en END
      WHERE vence_en <= ? OR intentos < ?
    `).bind(origin, now + attemptSeconds, now, now, now, maxLoginAttempts).run();
    return json({ error: 'Revisa tu usuario y contraseña.' }, 401);
  }
  const token = base64Url(crypto.getRandomValues(new Uint8Array(32)));
  await db.batch([
    db.prepare('DELETE FROM sesiones_panel WHERE vence_en <= ?').bind(now),
    db.prepare('DELETE FROM intentos_panel WHERE origen = ?').bind(origin),
    db.prepare('DELETE FROM intentos_panel WHERE vence_en <= ?').bind(now),
    db.prepare('INSERT INTO sesiones_panel (clave, vence_en) VALUES (?, ?)').bind(await sessionKey(verifier, token, ownerUsername), now + sessionSeconds),
  ]);
  return json({ ok: true }, 200, { 'Set-Cookie': ownerSessionCookie(token, sessionSeconds) });
}

function isOrderDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value ?? '') || value.startsWith('0000')) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function shiftDate(value, days) {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function dateBounds(period, from, until) {
  if (!period) return [];
  if (period === 'rango') return [from, until === '9999-12-31' ? null : shiftDate(until, 1)];
  const today = limaDate.format(new Date());
  if (period === 'ayer') return [shiftDate(today, -1), today];
  if (period === 'hoy') return [today, shiftDate(today, 1)];
  const weekday = new Date(`${today}T00:00:00Z`).getUTCDay();
  const start = shiftDate(today, -((weekday + 6) % 7));
  return [start, shiftDate(start, 7)];
}

async function readOwnerOrders(env, url) {
  const before = url.searchParams.get('antes');
  if (before !== null && !/^\d{1,18}$/.test(before)) return json({ error: 'Página inválida.' }, 400);
  const requestedSize = url.searchParams.get('por_pagina') ?? '50';
  if (!orderPageSizes.includes(requestedSize)) return json({ error: 'Elige cuántos pedidos mostrar por página.' }, 400);
  const pageSize = Number(requestedSize);
  const period = url.searchParams.get('periodo') || null;
  if (period && !orderPeriods.includes(period)) return json({ error: 'Elige un período de la lista.' }, 400);
  const from = period === 'rango' ? url.searchParams.get('desde') : null;
  const until = period === 'rango' ? url.searchParams.get('hasta') : null;
  if (period === 'rango' && (!isOrderDate(from) || !isOrderDate(until) || from > until)) {
    return json({ error: 'Revisa las fechas de inicio y fin del rango.' }, 400);
  }
  const search = normalizeAgency((url.searchParams.get('buscar') ?? '').slice(0, 120)) || null;
  const department = url.searchParams.get('departamento') || null;
  const stage = url.searchParams.get('estado') || null;
  const catalog = await panelCatalog(env, url);
  if ((department && !catalog.departamentos.includes(department)) || (stage && !orderStages.includes(stage))) {
    return json({ error: 'Elige un filtro de la lista.' }, 400);
  }
  const where = [];
  const params = [];
  const add = (sql, ...values) => { where.push(sql); params.push(...values); };
  if (before) add('id < CAST(? AS INTEGER)', before);
  if (department) add('departamento = ?', department);
  if (stage) add('estado = ?', stage);
  const [firstDay, endDay] = dateBounds(period, from, until);
  // El día de operación comienza a las 05:00 UTC (medianoche en Lima).
  if (firstDay) add('creado_en >= ?', `${firstDay}T05:00:00.000Z`);
  if (endDay) add('creado_en < ?', `${endDay}T05:00:00.000Z`);
  if (search) add(`(agencia IN (SELECT value FROM json_each(?)) OR NOT EXISTS (
    SELECT 1 FROM json_each(?) AS term
    WHERE instr('YIWU ' || substr(codigo, 6) || ' ' || busqueda, term.value) = 0
  ))`, JSON.stringify(catalog.agenciesMatching(search, department)), JSON.stringify(search.split(' ')));
  const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const { results: rows } = await env.DB.prepare(`
    SELECT ${orderColumns} FROM pedidos_despacho ${whereClause} ORDER BY id DESC LIMIT ?
  `).bind(...params, pageSize + 1).all();
  const pedidos = rows.slice(0, pageSize).map(catalog.withDestination);
  return json({ pedidos, siguiente: rows.length > pageSize ? String(pedidos.at(-1).id) : null, departamentos: catalog.departamentos });
}

function readOrder(db, codigo) {
  return db.prepare(`SELECT ${orderColumns} FROM pedidos_despacho WHERE codigo = ?`).bind(codigo).first();
}

async function deleteOwnerOrder(request, db) {
  const codigo = (await readJson(request))?.codigo;
  if (typeof codigo !== 'string' || codigo.length > 24 || !orderCode.test(codigo)) {
    return json({ error: 'Pedido inválido.' }, 422);
  }
  await db.prepare('DELETE FROM pedidos_despacho WHERE codigo = ?').bind(codigo).run();
  return json({ ok: true });
}

function storedPackages(fields) {
  return {
    shalom_mercaderia: fields.shalom_mercaderia,
    shalom_cantidad: fields.shalom_cantidad,
    shalom_medidas: fields.shalom_medidas === null ? null : JSON.stringify(fields.shalom_medidas),
    shalom_bultos: fields.shalom_bultos === null ? null : JSON.stringify(fields.shalom_bultos),
  };
}

function preparationFields(body, catalog) {
  const packages = body?.bultos ?? [body];
  if (!Array.isArray(packages) || !packages.length || packages.length > catalog.maximo) {
    return { error: 'Añade al menos un tamaño de bulto y revisa el límite de la plantilla.' };
  }
  const groups = new Map();
  for (const bundle of packages) {
    const type = bundle?.mercaderia;
    const quantity = bundle?.cantidad;
    const measures = bundle?.medidas ?? null;
    if (!catalog.mercaderias.includes(type)) return { error: 'Selecciona un tamaño de Shalom para cada grupo.' };
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 2147483647) {
      return { error: 'Ingresa una cantidad entera de bultos mayor que cero.' };
    }
    if (measures !== null && (!Array.isArray(measures) || measures.length !== 4 || !measures.every(Number.isFinite) ||
        measures.slice(0, 3).some(value => value <= 0) || measures[3] < 0)) {
      return { error: 'Revisa el alto, el ancho, el largo y el peso del paquete.' };
    }
    const key = JSON.stringify([type, measures]);
    const total = (groups.get(key)?.cantidad ?? 0) + quantity;
    if (total > 2147483647) return { error: 'La cantidad total de bultos para ese tamaño es demasiado alta.' };
    groups.set(key, { mercaderia: type, cantidad: total, medidas: measures });
  }
  const bundles = [...groups.values()];
  const [first] = bundles;
  return { fields: {
    shalom_mercaderia: first.mercaderia,
    shalom_cantidad: first.cantidad,
    shalom_medidas: first.medidas,
    shalom_bultos: bundles.length > 1 ? bundles : null,
  } };
}

async function prepareOwnerOrder(request, env, url) {
  const body = await readJson(request, maxBatchBytes);
  const codigo = body?.codigo;
  if (typeof codigo !== 'string' || !orderCode.test(codigo)) return json({ error: 'Pedido inválido.' }, 422);
  const catalog = await panelCatalog(env, url);
  const { fields, error } = preparationFields(body, catalog);
  if (error) return json({ error }, 422);

  const { shalom_mercaderia, shalom_cantidad, shalom_medidas, shalom_bultos } = storedPackages(fields);
  const pedido = await env.DB.prepare(`
    UPDATE pedidos_despacho SET shalom_mercaderia = ?, shalom_cantidad = ?, shalom_medidas = ?, shalom_bultos = ?
    WHERE codigo = ? AND despachado_en IS NULL RETURNING ${orderColumns}
  `).bind(shalom_mercaderia, shalom_cantidad, shalom_medidas, shalom_bultos, codigo).first();
  return pedido ? json({ pedido: catalog.withDestination(pedido) }) : json({ error: 'El pedido ya fue enviado o no está disponible.' }, 409);
}

async function confirmOwnerShipment(request, env, url) {
  const body = await readJson(request);
  if (typeof body?.codigo !== 'string' || !orderCode.test(body.codigo)) return json({ error: 'Pedido inválido.' }, 422);
  const [row, catalog] = await Promise.all([readOrder(env.DB, body.codigo), panelCatalog(env, url)]);
  if (!row) return json({ error: 'El pedido ya no está disponible.' }, 404);
  const order = catalog.withDestination(row);
  if (order.despachado_en) return json({ pedido: order });
  if (!order.shalom_destino || !catalog.mercaderias.includes(order.shalom_mercaderia) || !order.shalom_cantidad) {
    return json({ error: 'Guarda la preparación y verifica el destino antes de marcar el envío.' }, 409);
  }
  const [saved] = await shipOrders(env.DB, [row]);
  return saved?.despachado_en ? json({ pedido: catalog.withDestination(saved) }) : json({ error: 'El pedido ya no está disponible.' }, 409);
}

async function shipmentCandidates(db, codes, catalog) {
  const { results } = await db.prepare(`
    SELECT ${orderColumns} FROM pedidos_despacho WHERE codigo IN (SELECT value FROM json_each(?))
  `).bind(JSON.stringify(codes)).all();
  return results.filter(row => row.shalom_cantidad && catalog.mercaderias.includes(row.shalom_mercaderia) &&
    catalog.withDestination(row).shalom_destino);
}

async function shipOrders(db, orders) {
  if (!orders.length) return [];
  const snapshot = orders.map(({ codigo, agencia, departamento, shalom_mercaderia, shalom_cantidad, shalom_medidas, shalom_bultos }) =>
    [codigo, agencia, departamento, shalom_mercaderia, shalom_cantidad, shalom_medidas, shalom_bultos]);
  // Una sola escritura de lote mantiene la comprobación contra el pedido leído en la misma operación.
  const { results } = await db.prepare(`
    WITH datos(codigo_lote, agencia_lote, departamento_lote, tipo, cantidad, medidas, bultos) AS (
      SELECT value ->> 0, value ->> 1, value ->> 2, value ->> 3, value ->> 4, value ->> 5, value ->> 6 FROM json_each(?)
    )
    UPDATE pedidos_despacho SET despachado_en = coalesce(despachado_en, ?)
    FROM datos WHERE codigo = datos.codigo_lote AND agencia = datos.agencia_lote AND departamento = datos.departamento_lote
      AND shalom_mercaderia = datos.tipo AND shalom_cantidad = datos.cantidad
      AND shalom_medidas IS datos.medidas AND shalom_bultos IS datos.bultos
    RETURNING ${orderColumns}
  `).bind(JSON.stringify(snapshot), new Date().toISOString()).all();
  return results;
}

async function prepareOrders(db, changes) {
  const { results } = await db.prepare(`
    WITH datos(codigo_lote, tipo, cantidad, medidas, bultos) AS (
      SELECT value ->> 0, value ->> 1, value ->> 2, value ->> 3, value ->> 4 FROM json_each(?)
    )
    UPDATE pedidos_despacho
    SET shalom_mercaderia = datos.tipo, shalom_cantidad = datos.cantidad,
      shalom_medidas = datos.medidas, shalom_bultos = datos.bultos
    FROM datos WHERE codigo = datos.codigo_lote AND despachado_en IS NULL
      AND (shalom_mercaderia IS NULL OR shalom_cantidad IS NULL OR (
        shalom_mercaderia = datos.tipo AND shalom_cantidad = datos.cantidad
        AND shalom_medidas IS datos.medidas AND shalom_bultos IS datos.bultos
      ))
    RETURNING ${orderColumns}
  `).bind(JSON.stringify(changes)).all();
  return results;
}

async function updateOwnerBatch(request, env, url) {
  const body = await readJson(request, maxBatchBytes);
  const action = body?.accion;
  if (!['preparar', 'enviar'].includes(action) || !Array.isArray(body.pedidos) ||
      !body.pedidos.length || body.pedidos.length > maxBatchOrders) {
    return json({ error: `Selecciona entre 1 y ${maxBatchOrders} pedidos para el lote.` }, 422);
  }
  const codes = body.pedidos.map(order => order?.codigo);
  if (codes.some(code => typeof code !== 'string' || code.length > 24 || !orderCode.test(code)) ||
      new Set(codes).size !== codes.length) {
    return json({ error: 'La lista contiene códigos inválidos o repetidos.' }, 422);
  }
  const catalog = await panelCatalog(env, url);
  let rows;
  if (action === 'enviar') {
    rows = await shipOrders(env.DB, await shipmentCandidates(env.DB, codes, catalog));
  } else {
    const changes = [];
    for (const item of body.pedidos) {
      const { fields, error } = preparationFields(item, catalog);
      if (error) return json({ error: `${item.codigo}. ${error}` }, 422);
      const { shalom_mercaderia, shalom_cantidad, shalom_medidas, shalom_bultos } = storedPackages(fields);
      changes.push([item.codigo, shalom_mercaderia, shalom_cantidad, shalom_medidas, shalom_bultos]);
    }
    rows = await prepareOrders(env.DB, changes);
  }
  const pedidos = rows.map(catalog.withDestination);
  const saved = new Set(pedidos.map(order => order.codigo));
  return json({ pedidos, conflictos: codes.filter(code => !saved.has(code)) });
}

async function saveOwnerExport(request, env, url) {
  const body = await readJson(request, maxExportBytes);
  const dni = cleanText(body?.documento);
  if (!/^[0-9]{8}$/.test(dni) || dni === '00000000') {
    return json({ error: 'Ingresa los 8 dígitos del DNI de quien envía.' }, 422);
  }
  const phone = cleanText(body?.telefono).replace(/[\s().-]/g, '').replace(/^\+51/, '').replace(/^51(?=\d{8,9}$)/, '');
  if (!/^[1-9]\d{7,8}$/.test(phone)) return json({ error: 'Revisa el teléfono de quien envía.' }, 422);
  const grr = cleanText(body.grr).toUpperCase().replace(/\s*-\s*/g, '-');
  if (grr && (grr.length > 30 || !/^[A-Z0-9]+-\d+$/.test(grr))) {
    return json({ error: 'Revisa la serie y el número de la GRR.' }, 422);
  }
  if (!Array.isArray(body?.pedidos) || !body.pedidos.length) {
    return json({ error: 'Selecciona los pedidos que quieres exportar.' }, 422);
  }
  const catalog = await panelCatalog(env, url);
  if (!catalog.origenes.includes(body.origen)) return json({ error: 'Selecciona una agencia de origen de Shalom Pro.' }, 422);
  if (body.pedidos.length > catalog.maximo) return json({ error: `Selecciona hasta ${catalog.maximo} pedidos por archivo.` }, 422);

  const codes = body.pedidos;
  if (codes.some(code => typeof code !== 'string' || code.length > 24 || !orderCode.test(code)) ||
      new Set(codes).size !== codes.length) {
    return json({ error: 'La selección contiene pedidos inválidos o repetidos.' }, 422);
  }
  // Si falta un pedido preparado, la consulta no modifica ninguno de los contactos.
  const { results } = await env.DB.prepare(`
    WITH disponibles AS MATERIALIZED (
      SELECT codigo FROM pedidos_despacho
      WHERE codigo IN (SELECT value FROM json_each(?)) AND estado = 'preparado'
    )
    UPDATE pedidos_despacho SET shalom_contacto_doc = ?, shalom_contacto_telefono = ?, shalom_grr = ?
    WHERE codigo IN (SELECT codigo FROM disponibles) AND (SELECT count(*) FROM disponibles) = ?
    RETURNING ${orderColumns}
  `).bind(JSON.stringify(codes), dni, phone, grr || null, codes.length).all();
  if (results.length !== codes.length) return json({ error: 'Hay pedidos que ya no están preparados para exportar. Actualiza el listado y revisa la selección.' }, 409);
  const rows = new Map(results.map(order => [order.codigo, catalog.withDestination(order)]));
  return json({ pedidos: codes.map(code => rows.get(code)) });
}

async function ownerApi(request, env, url) {
  const method = request.method;
  if (method !== 'GET' && request.headers.get('Origin') !== url.origin) {
    return json({ error: 'Origen no autorizado.' }, 403);
  }
  const isSession = url.pathname === '/api/panel/sesion';
  const isOrders = url.pathname === '/api/panel/pedidos';
  const isShipment = url.pathname === '/api/panel/despacho';
  const isBatch = url.pathname === '/api/panel/lote';
  const isExport = url.pathname === '/api/panel/exportacion';
  if (!isSession && !isOrders && !isShipment && !isBatch && !isExport) return json({ error: 'Ruta no disponible.' }, 404);
  const verifier = env.YIWU_OWNER_PASSWORD_HASH?.trim();
  const ownerUsername = cleanText(env.YIWU_OWNER_USERNAME ?? 'yiwu').toLowerCase();
  if (!env.DB || !encodedDigest.test(verifier ?? '') || !ownerUsername || ownerUsername.length > 254) {
    return json({ error: 'El acceso del dueño aún no está configurado.' }, 503);
  }

  try {
    if (isSession && method === 'POST') return await startOwnerSession(request, env.DB, verifier, ownerUsername);
    const token = ownerToken(request);
    if (!token) return json({ error: 'Inicia sesión para ver los pedidos.' }, 401);
    const key = await sessionKey(verifier, token, ownerUsername);
    if (isSession && method === 'DELETE') {
      await env.DB.prepare('DELETE FROM sesiones_panel WHERE clave = ?').bind(key).run();
      return json({ ok: true }, 200, { 'Set-Cookie': ownerSessionCookie('', 0) });
    }
    const session = await env.DB.prepare('SELECT vence_en FROM sesiones_panel WHERE clave = ? AND vence_en > ?')
      .bind(key, Math.floor(Date.now() / 1000)).first('vence_en');
    if (session === null) {
      return json({ error: 'Inicia sesión para ver los pedidos.' }, 401, { 'Set-Cookie': ownerSessionCookie('', 0) });
    }
    if (isOrders && method === 'GET') return await readOwnerOrders(env, url);
    if (isOrders && method === 'PATCH') return await prepareOwnerOrder(request, env, url);
    if (isOrders && method === 'DELETE') return await deleteOwnerOrder(request, env.DB);
    if (isShipment && method === 'PATCH') return await confirmOwnerShipment(request, env, url);
    if (isBatch && method === 'PATCH') return await updateOwnerBatch(request, env, url);
    if (isExport && method === 'PATCH') return await saveOwnerExport(request, env, url);
    return json({ error: 'Operación no disponible.' }, 405);
  } catch {
    return json({ error: 'El panel no pudo completar la operación. Vuelve a intentarlo.' }, 502);
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/panel/')) return ownerApi(request, env, url);
    if (url.pathname !== '/api/pedidos') return env.ASSETS.fetch(request);
    if (request.method !== 'POST') {
      return new Response(null, { status: 405, headers: { Allow: 'POST', 'Cache-Control': 'no-store' } });
    }

    const origin = request.headers.get('Origin');
    if (origin && origin !== url.origin) return json({ error: 'Origen no autorizado' }, 403);
    const contentType = request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase();
    if (contentType !== 'application/json') return json({ error: 'Se requiere JSON' }, 415);

    const body = await readJson(request);
    if (!body || typeof body !== 'object' || Array.isArray(body)) return json({ error: 'Solicitud inválida' }, 400);

    const order = {
      solicitud: body.solicitud,
      agencia: cleanText(body.agencia),
      departamento: cleanText(body.departamento),
      direccion: cleanText(body.direccion),
      nombre: cleanText(body.nombre),
      dni: body.dni,
      celular: body.celular,
    };
    if (typeof order.solicitud !== 'string' || !requestId.test(order.solicitud) ||
        !order.agencia || !order.departamento || !order.direccion ||
        order.nombre.length > 120 || !fullName.test(order.nombre) ||
        typeof order.dni !== 'string' || !/^\d{8}$/.test(order.dni) ||
        typeof order.celular !== 'string' || !/^9\d{8}$/.test(order.celular)) {
      return json({ error: 'Datos inválidos' }, 422);
    }

    if (!env.DB) return json({ error: 'Registro no disponible' }, 503);
    try {
      if (!await catalogContainsOrder(env, url, order)) return json({ error: 'La agencia elegida no está disponible para este despacho.' }, 422);

      const codigo = await saveOrder(env.DB, { ...order, solicitud: order.solicitud.toLowerCase() });
      if (codigo === null) return json({ error: 'La solicitud ya se usó con otros datos' }, 409);
      if (typeof codigo !== 'string' || !orderCode.test(codigo)) return json({ error: 'Registro no confirmado' }, 502);

      const number = env.YIWU_WHATSAPP_NUMBER?.trim();
      const numeroWhatsApp = number && /^[1-9]\d{7,14}$/.test(number) ? number : '';
      return json({ codigo, numeroWhatsApp });
    } catch {
      return json({ error: 'Registro no confirmado' }, 502);
    }
  },
};
