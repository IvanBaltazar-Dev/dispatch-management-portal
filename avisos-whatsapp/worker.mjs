const batchSize = 5;
const maxBatches = 8;
const maxAttempts = 5;

function settings(env) {
  const token = env.WA_SHIPMENT_ACCESS_TOKEN?.trim();
  const phoneId = env.WA_SHIPMENT_PHONE_NUMBER_ID?.trim();
  const version = env.WA_SHIPMENT_API_VERSION?.trim();
  const template = env.WA_SHIPMENT_TEMPLATE?.trim();
  const language = env.WA_SHIPMENT_LANGUAGE?.trim();
  const image = URL.parse(env.WA_SHIPMENT_IMAGE_URL ?? '');
  if (!token || !/^\d+$/.test(phoneId ?? '') || !/^v\d+\.\d+$/.test(version ?? '') ||
      !template || !language || image?.protocol !== 'https:') {
    throw new Error('Completa la configuración de los avisos de WhatsApp.');
  }
  return { url: `https://graph.facebook.com/${version}/${phoneId}/messages`, token, template, language, image: image.href };
}

async function sendNotice(order, config, fetchMessage) {
  try {
    const response = await fetchMessage(config.url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.token}`, 'Content-Type': 'application/json' },
      redirect: 'error',
      signal: AbortSignal.timeout(8000),
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: `51${order.celular}`,
        type: 'template',
        template: {
          name: config.template,
          language: { code: config.language },
          components: [
            { type: 'header', parameters: [{ type: 'image', image: { link: config.image } }] },
            { type: 'body', parameters: [{ type: 'text', text: order.codigo }] },
          ],
        },
      }),
    });
    const data = await response.json().catch(() => null);
    const messageId = data?.messages?.[0]?.id;
    if (response.ok && typeof messageId === 'string' && messageId) return ['aceptado', 0, messageId, null];

    const metaCode = data?.error?.code;
    const code = Number.isInteger(metaCode) ? `meta_${metaCode}` : `http_${response.status}`;
    if ((response.status === 429 || metaCode === 130429 || metaCode === 131056) && order.intentos < maxAttempts) {
      return ['pendiente', Math.floor(Date.now() / 1000) + 60 * 2 ** (order.intentos - 1), null, code];
    }
    if (response.status >= 400 && response.status < 500 && response.status !== 408) return ['error', 0, null, code];
    return ['incierto', 0, null, code];
  } catch {
    return ['incierto', 0, null, 'sin_respuesta'];
  }
}

export async function processNotices(env, fetchMessage = fetch) {
  const config = settings(env);
  await env.DB.prepare(`
    UPDATE avisos_whatsapp SET estado = 'incierto', proximo_intento = 0, error_codigo = 'sin_confirmacion'
    WHERE estado = 'procesando' AND proximo_intento <= unixepoch()
  `).run();

  for (let batch = 0; batch < maxBatches; batch++) {
    const { results: orders } = await env.DB.prepare(`
      WITH candidatos AS MATERIALIZED (
        SELECT pedido_id FROM avisos_whatsapp WHERE estado = 'pendiente' AND proximo_intento <= unixepoch()
        ORDER BY proximo_intento, pedido_id LIMIT ?
      )
      UPDATE avisos_whatsapp SET estado = 'procesando', intentos = intentos + 1, proximo_intento = unixepoch() + 120
      WHERE pedido_id IN (SELECT pedido_id FROM candidatos)
      RETURNING pedido_id, intentos,
        (SELECT codigo FROM pedidos_despacho WHERE id = pedido_id) AS codigo,
        (SELECT celular FROM pedidos_despacho WHERE id = pedido_id) AS celular
    `).bind(batchSize).all();
    if (!orders.length) return;

    const outcomes = await Promise.all(orders.map(order => sendNotice(order, config, fetchMessage)));
    await env.DB.batch(orders.map((order, index) => env.DB.prepare(`
      UPDATE avisos_whatsapp SET estado = ?, proximo_intento = ?, meta_id = ?, error_codigo = ?
      WHERE pedido_id = ? AND estado = 'procesando' AND intentos = ?
    `).bind(...outcomes[index], order.pedido_id, order.intentos)));
  }
}

export default {
  async scheduled(_event, env) {
    await processNotices(env);
  },
};
