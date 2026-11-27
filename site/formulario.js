import { tipoDocumento } from './documento-destinatario.js';

const form = document.getElementById('despacho');
const search = document.getElementById('busqueda');
const searchStatus = document.getElementById('estado-busqueda');
const results = document.getElementById('resultados');
const scrollHint = document.getElementById('ayuda-desplazamiento');
const finder = document.getElementById('buscador');
const selection = document.getElementById('agencia-elegida');
const nameInput = document.getElementById('nombre');
const dniInput = document.getElementById('dni');
const phoneInput = document.getElementById('celular');
const advisorLink = document.querySelector('.header-channel');
const review = document.getElementById('revision');
const confirmButton = document.getElementById('confirmar-pedido');
const confirmLabel = confirmButton.querySelector('span');
const editButton = document.getElementById('editar');
const whatsappLink = document.getElementById('abrir-whatsapp');
const orderStatus = document.getElementById('estado-pedido');
const summaryDocumentType = document.getElementById('resumen-tipo-documento');
const summaryFields = Object.fromEntries(['agencia', 'ubicacion', 'direccion', 'nombre', 'dni', 'celular']
  .map(field => [field, document.getElementById(`resumen-${field}`)]));

const normalize = text => text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-z0-9]+/g, ' ').replace(/\bmega plaza\b/g, 'megaplaza').trim();

function formatAgencyText(text) {
  return text.trim().replace(/\s+/g, ' ')
    .replace(/\bcon con\b/gi, 'con')
    .replace(/\s(al|con|de|del|el|en|la|las|los|para|por|y)\b/gi, word => word.toLowerCase());
}

function splitAddress(address) {
  const marker = /[\s,.;–-]+\bref(?:erencias?)?\b[\s.:–-]*/i.exec(address);
  if (!marker) return { street: formatAgencyText(address), reference: '' };
  const street = formatAgencyText(address.slice(0, marker.index));
  const reference = formatAgencyText(address.slice(marker.index + marker[0].length));
  return { street, reference: reference.charAt(0).toUpperCase() + reference.slice(1) };
}

const agencies = Object.entries(window.yiwuShalomAgencies || {}).flatMap(([department, branches]) =>
  branches.filter(([, , proName]) => Boolean(proName)).map(([name, address, proName, detail = {}]) => {
    const title = normalize(name);
    const place = [...new Set([detail.distrito, detail.provincia, department].filter(Boolean))].join(' · ');
    const location = normalize(`${place} ${address} ${proName}`);
    return {
      name,
      department,
      address,
      place,
      ...splitAddress(address),
      map: detail.mapa,
      title: ` ${title} `,
      location: ` ${location} `,
      titleWords: title.split(' '),
      locationWords: location.split(' '),
    };
  })
);

let selectedAgency;
let order;
let savingOrder = false;

function showReference(id, value) {
  const field = document.getElementById(id);
  field.hidden = !value;
  field.lastElementChild.textContent = value;
}

function selectAgency(agency) {
  selectedAgency = agency;
  document.getElementById('agencia-nombre').textContent = agency.name;
  document.getElementById('agencia-ubicacion').textContent = agency.place;
  document.getElementById('agencia-direccion').textContent = agency.street;
  showReference('agencia-referencia', agency.reference);
  const mapLink = document.getElementById('agencia-mapa');
  if (agency.map) mapLink.href = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(agency.map)}`;
  mapLink.hidden = !agency.map;
  finder.hidden = true;
  selection.hidden = false;
  selection.focus();
}

function matchesSimilarWord(word, term) {
  if (word.startsWith(term)) return true;
  if (word.length < 4 || term.length < 4 || Math.abs(word.length - term.length) > 1) return false;

  let difference = 0;
  const shorterLength = Math.min(word.length, term.length);
  while (difference < shorterLength && word[difference] === term[difference]) difference += 1;

  const wordTail = word.slice(difference);
  const termTail = term.slice(difference);
  if (wordTail.length > termTail.length) return wordTail.slice(1) === termTail;
  if (termTail.length > wordTail.length) return termTail.slice(1) === wordTail;

  return wordTail.slice(1) === termTail.slice(1) || (
    wordTail[0] === termTail[1] && wordTail[1] === termTail[0] && wordTail.slice(2) === termTail.slice(2)
  );
}

function similarAgencyRank(agency, terms) {
  let rank = 0;
  for (const term of terms) {
    if (matchesSimilarWord(agency.titleWords[0], term)) rank += 3;
    else if (agency.titleWords.some(word => matchesSimilarWord(word, term))) rank += 2;
    else if (agency.locationWords.some(word => matchesSimilarWord(word, term))) rank += 1;
    else return 0;
  }
  return rank;
}

function findAgencies(terms, query) {
  if (query.length < 2) return { matches: [], similar: false };

  const exact = agencies.filter(agency => terms.every(term =>
    agency.title.includes(` ${term}`) || agency.location.includes(` ${term}`)
  ));
  if (exact.length) {
    const rank = agency => {
      if (agency.title.startsWith(` ${query} `)) return 3;
      if (agency.title.includes(` ${query} `)) return 2;
      return Number(agency.title.includes(` ${query}`));
    };
    exact.sort((left, right) => rank(right) - rank(left));
    return { matches: exact, similar: false };
  }

  const matches = agencies.map(agency => ({ agency, rank: similarAgencyRank(agency, terms) }))
    .filter(result => result.rank > 0)
    .sort((left, right) => right.rank - left.rank)
    .map(result => result.agency);
  return { matches, similar: true };
}

function renderAgencies() {
  const terms = normalize(search.value).split(' ').filter(term => term && term !== 'shalom');
  const query = terms.join(' ');
  const { matches, similar } = findAgencies(terms, query);

  const items = matches.map(agency => {
    const item = document.createElement('li');
    const button = document.createElement('button');
    const label = document.createElement('strong');
    const location = document.createElement('span');
    const address = document.createElement('span');
    button.type = 'button';
    button.className = 'agency-option';
    label.textContent = agency.name;
    location.className = 'agency-location';
    location.textContent = agency.place;
    address.className = 'agency-address';
    address.textContent = agency.street;
    button.append(label, location, address);
    button.addEventListener('click', () => selectAgency(agency));
    item.append(button);
    return item;
  });

  results.replaceChildren(...items);
  results.hidden = !items.length;
  results.scrollTop = 0;
  scrollHint.hidden = results.scrollHeight <= results.clientHeight;
  searchStatus.classList.remove('error');

  if (query.length < 2) {
    searchStatus.textContent = 'Escribe al menos 2 caracteres.';
  } else if (!items.length) {
    searchStatus.textContent = 'No encontramos una agencia disponible. Prueba con otro lugar o consulta a tu asesor.';
  } else if (similar) {
    searchStatus.textContent = matches.length === 1 ? '1 coincidencia similar' : `${matches.length} coincidencias similares`;
  } else {
    searchStatus.textContent = matches.length === 1 ? '1 agencia encontrada' : `${matches.length} agencias encontradas`;
  }
}

function verifyName() {
  const fullName = /^\p{L}[\p{L}\p{M}.'’\-]*(?:\s+\p{L}[\p{L}\p{M}.'’\-]*)+$/u;
  const invalid = nameInput.value && !fullName.test(nameInput.value.trim());
  nameInput.setCustomValidity(invalid ? 'Ingresa los nombres y apellidos de la persona que recoge.' : '');
}

function bindDigitLimit(input) {
  function fits(text) {
    const retained = input.value.length - (input.selectionEnd - input.selectionStart);
    return /^[0-9]+$/.test(text) && retained + text.length <= input.maxLength;
  }

  input.addEventListener('beforeinput', event => {
    if (event.data && !fits(event.data)) event.preventDefault();
  });

  input.addEventListener('paste', event => {
    const text = event.clipboardData?.getData('text');
    if (!text || fits(text)) return;
    event.preventDefault();
    const status = input.parentElement.querySelector('.field-status');
    status.textContent = `Pega solo dígitos, hasta completar ${input.maxLength}.`;
  });
}

function bindFieldCheck(input) {
  const control = input.parentElement;
  const check = control.querySelector('.field-check');
  const status = control.querySelector('.field-status');
  let completed = input !== nameInput;

  function updateCheck() {
    if (input === nameInput) verifyName();
    const valid = completed && input.validity.valid;
    if (check.hidden === !valid) return;
    check.hidden = !valid;
    status.textContent = valid ? `Campo válido: ${input.labels[0].textContent.trim()}.` : '';
  }

  input.addEventListener('input', updateCheck);
  input.addEventListener('blur', () => {
    completed = true;
    updateCheck();
  });
}

function shipmentDetails() {
  const cleanText = text => text.trim().replace(/\s+/g, ' ');
  return {
    agencia: cleanText(selectedAgency.name),
    departamento: cleanText(selectedAgency.department),
    direccion: cleanText(selectedAgency.address),
    nombre: cleanText(nameInput.value),
    dni: dniInput.value,
    celular: phoneInput.value,
  };
}

function buildMessage(shipment, code) {
  return [
    '📦 *Datos de envío Shalom*',
    `🧾 *Pedido:* ${code}`,
    '',
    '📍 *Agencia de destino*',
    `*Agencia:* ${shipment.agencia}`,
    `*Departamento:* ${shipment.departamento}`,
    `*Dirección:* ${shipment.direccion}`,
    '',
    '👤 *Datos de recojo*',
    `*Recoge:* ${shipment.nombre}`,
    `🪪 *${tipoDocumento(shipment.dni)}:* ${shipment.dni}`,
    `📱 *Celular:* ${shipment.celular}`,
  ].join('\n');
}

search.addEventListener('input', renderAgencies);

search.addEventListener('keydown', event => {
  if (event.key === 'Enter') {
    event.preventDefault();
    results.querySelector('button')?.focus();
  }
});

document.getElementById('cambiar-agencia').addEventListener('click', () => {
  selectedAgency = undefined;
  selection.hidden = true;
  finder.hidden = false;
  search.focus();
  search.select();
});

[dniInput, phoneInput].forEach(bindDigitLimit);
[nameInput, dniInput, phoneInput].forEach(bindFieldCheck);

form.addEventListener('submit', event => {
  event.preventDefault();
  if (!selectedAgency) {
    searchStatus.textContent = 'Elige una agencia de la lista para continuar.';
    searchStatus.classList.add('error');
    search.focus();
    return;
  }

  verifyName();
  if (!form.reportValidity()) return;

  const shipment = shipmentDetails();
  if (!order || !Object.keys(shipment).every(field => order.shipment[field] === shipment[field])) {
    order = { id: crypto.randomUUID(), shipment };
  }
  for (const field of ['nombre', 'dni', 'celular']) summaryFields[field].textContent = shipment[field];
  summaryDocumentType.textContent = tipoDocumento(shipment.dni);
  summaryFields.agencia.textContent = selectedAgency.name;
  summaryFields.ubicacion.textContent = selectedAgency.place;
  summaryFields.direccion.textContent = selectedAgency.street;
  showReference('resumen-referencia', selectedAgency.reference);
  review.showModal();
  confirmButton.focus();
});

function closeReview() {
  if (order?.code) {
    order = undefined;
    selectedAgency = undefined;
    form.reset();
    selection.hidden = true;
    finder.hidden = false;
    [nameInput, dniInput, phoneInput].forEach(input => input.dispatchEvent(new Event('input')));
    renderAgencies();
  }
  Object.values(summaryFields).forEach(field => { field.textContent = ''; });
  orderStatus.hidden = true;
  orderStatus.textContent = '';
  orderStatus.classList.remove('error');
  confirmButton.hidden = false;
  confirmLabel.textContent = 'Confirmar pedido';
  whatsappLink.hidden = true;
  whatsappLink.removeAttribute('href');
  editButton.textContent = 'Volver a editar';
  review.close();
}

editButton.addEventListener('click', closeReview);
review.addEventListener('cancel', event => {
  event.preventDefault();
  if (!savingOrder) closeReview();
});

confirmButton.addEventListener('click', async () => {
  if (!order || order.code || savingOrder || !review.open) return;
  savingOrder = true;
  confirmButton.disabled = true;
  editButton.disabled = true;
  confirmLabel.textContent = 'Guardando pedido…';
  orderStatus.hidden = true;
  orderStatus.classList.remove('error');

  let receipt;
  try {
    const response = await fetch('/api/pedidos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ solicitud: order.id, ...order.shipment }),
      signal: AbortSignal.timeout(15000),
    });
    if (response.ok) {
      receipt = await response.json();
      if (!/^YIWU-\d{6,}$/.test(receipt?.codigo)) receipt = undefined;
    }
    if (!receipt) {
      orderStatus.textContent = response.status === 422
        ? 'Revisa los datos y la agencia elegida antes de volver a guardar.'
        : 'No pudimos confirmar el guardado. Vuelve a intentarlo.';
    }
  } catch {
    orderStatus.textContent = 'No pudimos confirmar el guardado. Vuelve a intentarlo.';
  } finally {
    savingOrder = false;
    confirmButton.disabled = false;
    editButton.disabled = false;
    orderStatus.hidden = false;
  }

  if (!receipt) {
    confirmLabel.textContent = 'Volver a intentar';
    orderStatus.classList.add('error');
    confirmButton.focus();
    return;
  }

  order.code = receipt.codigo;
  confirmButton.hidden = true;
  editButton.textContent = 'Cerrar';
  const validNumber = /^[1-9]\d{7,14}$/;
  const advisorNumber = validNumber.test(receipt.numeroWhatsApp)
    ? receipt.numeroWhatsApp
    : new URL(advisorLink.href).pathname.slice(1);
  if (!validNumber.test(advisorNumber)) {
    orderStatus.textContent = `Pedido ${order.code} guardado. El WhatsApp del asesor no está disponible en este momento.`;
    orderStatus.classList.add('error');
    editButton.focus();
    return;
  }

  // El redireccionamiento de wa.me puede sustituir los emojis del mensaje.
  const destination = new URL(`https://api.whatsapp.com/send?phone=${advisorNumber}&text=${encodeURIComponent(buildMessage(order.shipment, order.code))}`);
  orderStatus.textContent = `Pedido ${order.code} guardado. Toca Enviar en WhatsApp.`;
  whatsappLink.href = destination.href;
  whatsappLink.hidden = false;
  whatsappLink.focus();
  window.location.assign(whatsappLink.href);
});

if (!agencies.length) {
  search.disabled = true;
  document.getElementById('revisar').disabled = true;
  searchStatus.classList.add('error');
  searchStatus.textContent = 'No se pudo cargar el directorio. Recarga la página o contacta a tu asesor.';
}

form.hidden = false;
