import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import panel from '../site/_worker.js';
import { processNotices } from './worker.mjs';

const origin = 'https://yiwu.test';
const testPhone = '900000000';
const token = createHash('sha256').update('test session').digest('base64url');
const verifier = createHash('sha256').update('test password').digest('base64url');
const session = createHash('sha256').update(`sesion:${verifier}:${token}`).digest('base64url');
const schema = readFileSync(new URL('../setup/esquema-d1.sql', import.meta.url), 'utf8');
const migration = readFileSync(new URL('../setup/avisos-whatsapp-d1.sql', import.meta.url), 'utf8');
const confirmationMigration = readFileSync(new URL('../setup/confirmacion-whatsapp-d1.sql', import.meta.url), 'utf8');

function testEnv(t, beforeMigration = '') {
  const database = new DatabaseSync(':memory:');
  t.after(() => database.close());
  database.exec(schema + beforeMigration + migration + confirmationMigration);
  database.prepare('INSERT INTO sesiones_panel VALUES (?, unixepoch() + 3600)').run(session);
  const db = {
    prepare(sql) {
      const statement = database.prepare(sql);
      const bind = (...params) => ({
        async all() { return { results: statement.all(...params) }; },
        async first(column) {
          const row = statement.get(...params);
          return column ? row?.[column] ?? null : row ?? null;
        },
        async run() { return { meta: statement.run(...params) }; },
      });
      return { bind, ...bind() };
    },
    batch(statements) { return Promise.all(statements.map(statement => statement.run())); },
  };
  const env = {
    DB: db,
    ASSETS: { fetch: url => new URL(url).pathname.endsWith('.js')
      ? new Response('window.yiwuShalomAgencies = {"Lima":[["LIMA","Av. Prueba","LIMA"]]};')
      : Response.json({ origenes: ['LIMA'], destinos: ['LIMA'], mercaderias: ['CAJA'], maximo: 100 }) },
    YIWU_OWNER_PASSWORD_HASH: verifier,
    WA_SHIPMENT_ACCESS_TOKEN: 'test-token',
    WA_SHIPMENT_PHONE_NUMBER_ID: '1234',
    WA_SHIPMENT_API_VERSION: 'v27.0',
    WA_SHIPMENT_TEMPLATE: 'pedido_en_shalom',
    WA_SHIPMENT_LANGUAGE: 'es',
    WA_SHIPMENT_IMAGE_URL: `${origin}/aviso-despacho-shalom.jpg`,
  };
  return { env, database };
}

async function request(env, path, method, body, expected = 200) {
  const response = await panel.fetch(new Request(origin + path, {
    method,
    headers: { Origin: origin, 'Content-Type': 'application/json', Cookie: `__Host-yiwu_owner=${token}` },
    body: JSON.stringify(body),
  }), env);
  const data = await response.json();
  assert.equal(response.status, expected, JSON.stringify(data));
  return data;
}

async function createOrder(env, data = {}) {
  return (await request(env, '/api/pedidos', 'POST', {
    solicitud: randomUUID(), agencia: 'LIMA', departamento: 'Lima', direccion: 'Av. Prueba',
    nombre: 'Cliente Prueba', dni: '00000001', celular: testPhone, ...data,
  })).codigo;
}

async function prepare(env, codigo) {
  await request(env, '/api/panel/pedidos', 'PATCH', { codigo, mercaderia: 'CAJA', cantidad: 1 });
}

function accepted() {
  return Response.json({ messages: [{ id: 'wamid.test' }] });
}

test('solo programa un aviso por pedido autorizado cuando se marca enviado', async t => {
  const { env, database } = testEnv(t, `
    INSERT INTO pedidos_despacho (solicitud, agencia, departamento, direccion, nombre, dni, celular, busqueda,
      shalom_mercaderia, shalom_cantidad, despachado_en)
    VALUES ('anterior', 'LIMA', 'Lima', 'Av. Prueba', 'Cliente Prueba', '00000001', '${testPhone}', 'CLIENTE',
      'CAJA', 1, '2026-11-24T10:00:00.000Z');
  `);
  const data = { solicitud: randomUUID(), notificar_whatsapp: true };
  const single = await createOrder(env, data);
  assert.equal(await createOrder(env, data), single);
  const grouped = await createOrder(env, { notificar_whatsapp: true });
  const declined = await createOrder(env, { notificar_whatsapp: false });
  const oldForm = await createOrder(env);
  for (const codigo of [single, grouped, declined, oldForm]) await prepare(env, codigo);
  assert.equal(database.prepare('SELECT count(*) AS total FROM avisos_whatsapp').get().total, 0);

  await request(env, '/api/panel/despacho', 'PATCH', { codigo: single });
  const lote = { accion: 'enviar', pedidos: [single, grouped, declined, oldForm].map(codigo => ({ codigo })) };
  assert.equal((await request(env, '/api/panel/lote', 'PATCH', lote)).pedidos.length, 4);
  await request(env, '/api/panel/lote', 'PATCH', lote);

  const messages = [];
  const fetchMessage = async (url, options) => {
    assert.equal(url, 'https://graph.facebook.com/v27.0/1234/messages');
    assert.equal(options.headers.Authorization, 'Bearer test-token');
    messages.push(JSON.parse(options.body));
    return accepted();
  };
  await Promise.all([processNotices(env, fetchMessage), processNotices(env, fetchMessage)]);
  assert.equal(messages.length, 1);
  assert.equal(messages[0].template.components[1].parameters[0].text, grouped);
  for (const message of messages) {
    assert.equal(message.to, `51${testPhone}`);
    assert.equal(message.type, 'template');
    assert.deepEqual(message.template.components[0], {
      type: 'header', parameters: [{ type: 'image', image: { link: env.WA_SHIPMENT_IMAGE_URL } }],
    });
  }
  const { pedidos } = await request(env, '/api/panel/pedidos', 'GET');
  assert.equal(pedidos.find(order => order.codigo === single).aviso_whatsapp, null);
  assert.equal(pedidos.find(order => order.codigo === grouped).aviso_whatsapp, 'aceptado');
  assert.equal(pedidos.find(order => order.codigo === declined).aviso_whatsapp, null);
  await request(env, '/api/panel/aviso-whatsapp', 'PATCH', { codigo: single }, 409);
});

test('abre WhatsApp con el texto indicado y permite reconfirmar sin cambiar la fecha de despacho', async t => {
  const { env } = testEnv(t);
  const codigo = await createOrder(env);
  const confirm = (expected = 200) => request(env, '/api/panel/despacho', 'PATCH', { codigo }, expected);
  await confirm(409);
  await prepare(env, codigo);

  const { pedido, enlace_whatsapp } = await confirm();
  const link = new URL(enlace_whatsapp);
  assert.equal(link.origin, 'https://api.whatsapp.com');
  assert.equal(link.pathname, '/send');
  assert.equal(link.searchParams.get('phone'), `51${testPhone}`);
  assert.equal(link.searchParams.get('text'), '🎉 ¡Buenas noticias!\n\n📦 Tu pedido ya está en SHALOM, listo para ser enviado. 🚚\n\n💚 ¡Gracias por comprar en YIWU CENTER!');
  assert.ok(pedido.despachado_en);
  assert.ok(pedido.whatsapp_preparado_en);
  assert.equal(pedido.aviso_whatsapp, null);

  const second = await confirm();
  assert.equal(second.enlace_whatsapp, enlace_whatsapp);
  assert.equal(second.pedido.despachado_en, pedido.despachado_en);
  const { pedidos } = await request(env, '/api/panel/pedidos', 'GET');
  assert.equal(pedidos[0].whatsapp_preparado_en, second.pedido.whatsapp_preparado_en);
});

test('reintenta rechazos confirmados y conserva los envíos sin respuesta para revisión', async t => {
  const { env, database } = testEnv(t);
  const codes = [];
  for (let index = 0; index < 3; index++) {
    const codigo = await createOrder(env, { notificar_whatsapp: true });
    await prepare(env, codigo);
    codes.push(codigo);
  }
  await request(env, '/api/panel/lote', 'PATCH', { accion: 'enviar', pedidos: codes.map(codigo => ({ codigo })) });
  await processNotices(env, async (_url, { body }) => {
    const code = JSON.parse(body).template.components[1].parameters[0].text;
    if (code === codes[0]) return Response.json({ error: { code: 130429 } }, { status: 429 });
    if (code === codes[1]) return Response.json({ error: { code: 132001 } }, { status: 400 });
    throw new Error('No se recibió una respuesta de Meta');
  });
  const states = () => database.prepare('SELECT estado FROM avisos_whatsapp ORDER BY pedido_id').all().map(row => row.estado);
  assert.deepEqual(states(), ['pendiente', 'error', 'incierto']);
  await processNotices(env, () => assert.fail('Los avisos aún no debían reintentarse'));
  await request(env, '/api/panel/aviso-whatsapp', 'PATCH', { codigo: codes[2] }, 409);
  await request(env, '/api/panel/aviso-whatsapp', 'PATCH', { codigo: codes[1] });
  database.exec("UPDATE avisos_whatsapp SET proximo_intento = 0 WHERE estado = 'pendiente'");
  await processNotices(env, async () => accepted());
  assert.deepEqual(states(), ['aceptado', 'aceptado', 'incierto']);
});

test('procesa un lote de cien pedidos en varias ejecuciones sin repetir avisos', async t => {
  const { env } = testEnv(t);
  const pedidos = [];
  for (let index = 0; index < 100; index++) {
    const codigo = await createOrder(env, { notificar_whatsapp: true });
    pedidos.push({ codigo, mercaderia: 'CAJA', cantidad: 1 });
  }
  await request(env, '/api/panel/lote', 'PATCH', { accion: 'preparar', pedidos });
  const { conflictos } = await request(env, '/api/panel/lote', 'PATCH', { accion: 'enviar', pedidos });
  assert.deepEqual(conflictos, []);

  const messages = [];
  const fetchMessage = async (_url, { body }) => {
    messages.push(JSON.parse(body).template.components[1].parameters[0].text);
    return accepted();
  };
  await processNotices(env, fetchMessage);
  assert.equal(messages.length, 40);
  await processNotices(env, fetchMessage);
  await processNotices(env, fetchMessage);
  assert.deepEqual(messages.sort(), pedidos.map(({ codigo }) => codigo));
});
