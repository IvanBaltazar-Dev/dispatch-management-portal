import { exportShalom } from './shalom-export.js';
import { createPackagePreview } from './paquete-3d.js';
import { createBatchEditor } from './lote.js';
import { createShalomReview } from './revision-shalom.js';
import { createPackageList, packagesOf, showPackageMeasures as measureUnits } from './bultos.js';

const byId = id => document.getElementById(id);
const login = byId('login');
const loginSubmit = byId('ingresar');
const password = byId('clave');
const showPassword = byId('ver-clave');
const logout = byId('salir');
const panel = byId('panel');
const topbar = byId('barra-panel');
const ordersTable = byId('filas');
const all = byId('marcar-todos');
const form = byId('datos-envio');
const dialog = byId('preparacion');
const exportButton = byId('exportar');
const batchActions = byId('acciones-lote');
const selectedCount = byId('cantidad-seleccionada');
const selectedLabel = byId('texto-seleccion');
const prepareBatch = byId('preparar-lote');
const sendBatch = byId('enviar-lote');
const deleteBatch = byId('eliminar-lote');
const clearBatch = byId('limpiar-lote');
const maxBatchOrders = 100;
const ordersPerLoad = 25;
const editorSave = byId('guardar');
const editorCancel = byId('cancelar');
const editorClose = byId('cerrar-preparacion');
const search = byId('buscar-pedido');
const regionFilter = byId('filtro-departamento');
const stageButtons = [...byId('filtro-etapa').querySelectorAll('button')];
const dateButtons = [...byId('filtro-fecha').querySelectorAll('button')];
const dateRange = byId('filtro-rango');
const dateFrom = byId('fecha-desde');
const dateTo = byId('fecha-hasta');
const rangeToggle = byId('abrir-rango');
const rangeSummary = byId('rango-aplicado');
const clearDate = byId('limpiar-fecha');
const refresh = byId('actualizar');
const results = byId('resultados-pedidos');
const feed = byId('pie-pedidos');
const feedStatus = byId('conteo-pedidos');
const retryOrders = byId('reintentar-pedidos');
const shipmentDialog = byId('confirmar-despacho');
const shipmentSave = byId('guardar-despacho');
const shipmentCancel = byId('cancelar-despacho');
const deletionDialog = byId('confirmar-eliminacion');
const deletionSave = byId('guardar-eliminacion');
const deletionCancel = byId('cancelar-eliminacion');
const stages = [['recibido', 'Recibido'], ['preparado', 'Preparado'], ['enviado', 'Enviado']];
const measureKeys = ['alto', 'ancho', 'largo', 'peso'];
const customMeasures = measureKeys.map(byId);
const drawPackage = createPackagePreview(byId('caja-3d'));
const batchEditor = createBatchEditor(saveBatch);
const exportReview = createShalomReview(downloadReviewedExcel);
const selected = new Map();
const orders = new Map();
const localDate = new Intl.DateTimeFormat('es-PE', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Lima' });
const rangeDate = new Intl.DateTimeFormat('es-PE', { dateStyle: 'medium', timeZone: 'UTC' });
const fileDate = new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Lima' });
const measureFormat = new Intl.NumberFormat('es-PE', { maximumFractionDigits: 2 });
let catalog;
let activeFilters;
let nextCursor = null;
let listRequest;
let loadFailure;
let draft;
let loading = false;
let exporting = false;
let filterStage = '';
let filterDate = { period: '' };
let filterTimer;
let shipment;
let deletionCodes = [];
let extraPackages;
let shipmentPackages;

const hasPackage = order => Boolean(order.shalom_mercaderia && order.shalom_cantidad);
const isReady = order => hasPackage(order) && Boolean(order.shalom_destino) && !order.despachado_en;
const canPrepare = order => !order.despachado_en && !hasPackage(order);
const orderStage = order => order.despachado_en ? 'enviado' : hasPackage(order) ? 'preparado' : 'recibido';
const hasFilter = () => Boolean(search.value.trim() || regionFilter.value || filterStage || filterDate.period);

if (window.location.protocol === 'https:') {
  byId('seguridad').textContent = 'Conexión cifrada y acceso reservado a la cuenta autorizada de YIWU.';
}

function setPasswordVisible(visible) {
  password.type = visible ? 'text' : 'password';
  showPassword.setAttribute('aria-label', visible ? 'Ocultar contraseña' : 'Mostrar contraseña');
  showPassword.querySelector('.icon').classList.toggle('eye-off-icon', visible);
}
showPassword.addEventListener('click', () => setPasswordVisible(password.type === 'password'));

function status(id, message = '', error = false) {
  const text = byId(id);
  text.textContent = message;
  text.classList.toggle('error', error);
  text.hidden = !message;
}

async function api(path, options = {}) {
  const request = { cache: 'no-store', ...options };
  if (request.body) request.headers = { 'Content-Type': 'application/json' };
  const response = await fetch(`/api/panel/${path}`, request);
  const data = await response.json();
  if (response.ok) return data;
  throw Object.assign(new Error(data.error), { status: response.status });
}

function setLogin(message = '') {
  listRequest?.abort();
  listRequest = undefined;
  loadFailure = undefined;
  loading = false;
  refresh.disabled = false;
  refresh.setAttribute('aria-busy', 'false');
  results.setAttribute('aria-busy', 'false');
  draft = undefined;
  form.reset();
  if (dialog.open) dialog.close();
  if (shipmentDialog.open) shipmentDialog.close();
  if (deletionDialog.open) deletionDialog.close();
  batchEditor.close();
  exportReview.close();
  clearOrders();
  clearTimeout(filterTimer);
  filterTimer = undefined;
  search.value = '';
  regionFilter.value = '';
  filterStage = '';
  resetDateFilter();
  updateFilterControls();
  status('estado-panel');
  status('estado-inicial');
  status('error-login', message, true);
  panel.hidden = true;
  topbar.hidden = true;
  byId('acceso').hidden = false;
  updateFeed();
  updateSelection();
}

function optionsFor(list, values) {
  list.append(...values.map(value => new Option(value, value)));
}

async function loadCatalog() {
  if (catalog) return;
  const response = await fetch('/panel/shalom-catalogo.json');
  if (!response.ok) throw new Error('No se pudo cargar el catálogo de Shalom Pro.');
  catalog = await response.json();
  optionsFor(byId('mercaderia'), catalog.mercaderias);
}

function updateSelection() {
  all.disabled = loading || !orders.size;
  all.checked = orders.size > 0 && selected.size === orders.size;
  all.indeterminate = selected.size > 0 && !all.checked;
  const selection = [...selected.values()];
  const ready = selection.filter(isReady).length;
  const pending = selection.filter(canPrepare).length;
  if (selectedCount.textContent !== String(selected.size)) {
    selectedCount.textContent = selected.size;
    selectedLabel.textContent = selected.size === 1 ? 'seleccionado' : 'seleccionados';
  }
  batchActions.hidden = !selected.size;
  clearBatch.disabled = loading;
  deleteBatch.disabled = loading;
  deleteBatch.textContent = `Eliminar seleccionados (${selected.size})`;
  prepareBatch.hidden = !pending;
  prepareBatch.disabled = loading;
  prepareBatch.querySelector('span').textContent = `Preparar (${pending})`;
  sendBatch.hidden = !ready;
  sendBatch.disabled = loading;
  sendBatch.querySelector('span').textContent = `Marcar enviados (${ready})`;
  exportButton.hidden = !ready;
  exportButton.disabled = exporting || loading || !ready;
  exportButton.querySelector('span').textContent = `Exportar Excel (${ready})`;
}

function updateFilterControls() {
  for (const button of stageButtons) button.setAttribute('aria-pressed', String(button.dataset.stage === filterStage));
  for (const button of dateButtons) button.setAttribute('aria-pressed', String(button.dataset.period === filterDate.period));
  rangeSummary.hidden = filterDate.period !== 'rango' || !dateRange.hidden;
  clearDate.hidden = !filterDate.period;
  if (filterDate.period === 'rango') {
    rangeSummary.textContent = rangeDate.formatRange(new Date(filterDate.from), new Date(filterDate.to));
  }
  byId('limpiar-filtros').hidden = !hasFilter();
}

function showDateRange(open) {
  dateRange.hidden = !open;
  rangeToggle.setAttribute('aria-expanded', String(open));
  rangeSummary.hidden = open || filterDate.period !== 'rango';
}

function resetDateFilter() {
  filterDate = { period: '' };
  dateRange.reset();
  dateTo.setCustomValidity('');
  showDateRange(false);
}

function applyFilters() {
  clearTimeout(filterTimer);
  filterTimer = undefined;
  void loadOrders(null, 'filter');
}

function textCell(row, text, detail) {
  const cell = row.insertCell();
  cell.setAttribute('role', 'cell');
  cell.textContent = text;
  if (detail) {
    const caption = document.createElement('small');
    caption.textContent = detail;
    cell.append(caption);
  }
  return cell;
}

function phoneLabel(phone) {
  return `Cel. ${phone?.replace(/^(\d{3})(\d{3})(\d{3})$/, '$1 $2 $3') || '—'}`;
}

function timeline(order) {
  const current = stages.findIndex(([stage]) => stage === orderStage(order));
  const list = document.createElement('ol');
  list.className = 'order-timeline';
  list.setAttribute('role', 'list');
  list.setAttribute('aria-label', 'Etapas del pedido');
  stages.forEach(([stage, label], index) => {
    const item = document.createElement('li');
    item.dataset.stage = stage;
    if (index <= current) item.className = index === current ? 'current' : 'complete';
    if (index === current) item.setAttribute('aria-current', 'step');
    const marker = document.createElement('i');
    marker.setAttribute('aria-hidden', 'true');
    const text = document.createElement('span');
    text.textContent = label;
    item.append(marker, text);
    list.append(item);
  });
  return list;
}

function orderButton(label, order, onClick, appearance = 'secondary') {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `button ${appearance}`;
  button.textContent = label;
  button.setAttribute('aria-label', `${label} ${order.codigo}`);
  button.addEventListener('click', () => onClick(order));
  return button;
}

function cardField(cell, field, icon, label) {
  cell.className = field;
  const caption = document.createElement('span');
  caption.className = 'mobile-card-label';
  const marker = document.createElement('i');
  marker.className = `icon ${icon}-icon`;
  marker.setAttribute('aria-hidden', 'true');
  caption.append(marker, label);
  cell.prepend(caption);
}

function renderOrder(order) {
  const row = document.createElement('tr');
  row.id = order.codigo;
  row.dataset.estado = orderStage(order);
  row.setAttribute('role', 'row');
  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.setAttribute('aria-label', `Seleccionar ${order.codigo}`);
  checkbox.checked = selected.has(order.codigo);
  checkbox.addEventListener('change', () => {
    if (loading) {
      checkbox.checked = selected.has(order.codigo);
      return;
    }
    if (checkbox.checked) selected.set(order.codigo, order);
    else selected.delete(order.codigo);
    status('error-seleccion');
    updateSelection();
  });
  const selectionCell = textCell(row, '');
  selectionCell.className = 'cell-select';
  selectionCell.append(checkbox);
  textCell(row, order.codigo, localDate.format(new Date(order.creado_en))).className = 'order-code';
  const recipient = textCell(row, order.nombre);
  const recipientDetails = document.createElement('small');
  for (const value of [`DNI ${order.dni}`, phoneLabel(order.celular)]) {
    const detail = document.createElement('span');
    detail.textContent = value;
    recipientDetails.append(detail);
  }
  recipient.append(recipientDetails);
  cardField(recipient, 'recipient', 'person', 'Destinatario');
  cardField(textCell(row, order.agencia, order.shalom_ubicacion || order.departamento), 'destination', 'pin', 'Agencia de destino');
  const bundles = packagesOf(order);
  const units = bundles.reduce((total, bundle) => total + bundle.cantidad, 0);
  const size = bundles.length > 1 ? `${bundles.length} tamaños` : order.shalom_mercaderia || 'Sin preparar';
  const packageDetail = units ? `${units} ${units === 1 ? 'bulto' : 'bultos'}` : '';
  cardField(textCell(row, size, packageDetail), 'merchandise', 'box', 'Mercadería');
  const state = textCell(row, '');
  state.className = 'preparation';
  state.append(timeline(order));
  if (!order.shalom_destino) {
    const warning = document.createElement('small');
    warning.className = 'destination-warning';
    warning.textContent = 'Revisar destino';
    state.append(warning);
  } else if (order.despachado_en) {
    const date = document.createElement('small');
    date.textContent = localDate.format(new Date(order.despachado_en));
    state.append(date);
  }
  const action = textCell(row, '');
  action.className = 'order-action';
  const actions = document.createElement('div');
  actions.className = 'row-actions';
  const label = order.despachado_en ? 'Ver pedido' : hasPackage(order) ? 'Editar' : 'Preparar';
  actions.append(orderButton(label, order, editOrder));
  if (isReady(order)) actions.append(orderButton('Marcar enviado', order, confirmShipment, 'dispatch-action'));
  const deleteAction = orderButton('Eliminar', order, target => confirmDeletion([target]), 'ghost delete-action');
  deleteAction.setAttribute('aria-haspopup', 'dialog');
  actions.append(deleteAction);
  action.append(actions);
  return row;
}

function clearOrders() {
  orders.clear();
  nextCursor = null;
  selected.clear();
  ordersTable.replaceChildren();
  status('error-seleccion');
}

function appendOrders(batch) {
  const rows = document.createDocumentFragment();
  for (const order of batch) {
    if (orders.has(order.codigo)) continue;
    orders.set(order.codigo, order);
    rows.append(renderOrder(order));
  }
  ordersTable.append(rows);
}

function updateFeed() {
  const count = orders.size;
  const busy = Boolean(listRequest);
  const visible = count > 0 || busy || Boolean(nextCursor || loadFailure);
  byId('sin-pedidos').hidden = visible;
  results.hidden = !visible;
  if (!visible) {
    byId('sin-pedidos-titulo').textContent = hasFilter() ? 'Sin resultados' : 'Aún no hay pedidos';
    byId('sin-pedidos-texto').textContent = hasFilter() ? 'Prueba con otra fecha, destino o estado.' :
      'Los pedidos aparecerán aquí cuando el cliente complete el formulario.';
  }
  feed.hidden = !visible;
  retryOrders.hidden = !loadFailure;
  const countText = count === 1 ? '1 pedido' : `${count} pedidos`;
  const message = busy ? (loading ? 'Cargando pedidos…' : 'Cargando más pedidos…') :
    loadFailure ? loadFailure.message : nextCursor ? `${countText} cargados` : countText;
  if (feedStatus.textContent !== message) feedStatus.textContent = message;
  feed.dataset.loading = String(busy);
  if (!panel.hidden && nextCursor && !busy && !loadFailure && !filterTimer) {
    ordersObserver.observe(feed);
  } else {
    ordersObserver.unobserve(feed);
  }
}

function orderFilters() {
  const params = new URLSearchParams({ por_pagina: ordersPerLoad });
  if (search.value.trim()) params.set('buscar', search.value.trim());
  if (regionFilter.value) params.set('departamento', regionFilter.value);
  if (filterStage) params.set('estado', filterStage);
  if (filterDate.period) params.set('periodo', filterDate.period);
  if (filterDate.period === 'rango') {
    params.set('desde', filterDate.from);
    params.set('hasta', filterDate.to);
  }
  return params;
}

async function loadOrders(target = null, change = '') {
  if (target && (listRequest || filterTimer)) return;
  listRequest?.abort();
  const request = new AbortController();
  listRequest = request;
  loadFailure = undefined;
  loading = !target;
  if (change === 'filter') clearOrders();
  if (!target) {
    status('estado-panel');
    refresh.disabled = true;
    refresh.setAttribute('aria-busy', String(change === 'refresh'));
    logout.disabled = true;
  }
  results.setAttribute('aria-busy', 'true');
  updateFeed();
  updateSelection();

  const params = target ? new URLSearchParams(activeFilters) : orderFilters();
  if (target) params.set('antes', target);
  try {
    const data = await api(`pedidos?${params}`, { signal: request.signal });
    await loadCatalog();
    if (listRequest !== request) return;
    if (regionFilter.options.length === 1) optionsFor(regionFilter, data.departamentos);
    if (!target) {
      activeFilters = params;
      clearOrders();
    }
    nextCursor = data.siguiente === target ? null : data.siguiente;
    appendOrders(data.pedidos);
    status('estado-inicial');
    byId('acceso').hidden = true;
    topbar.hidden = false;
    panel.hidden = false;
  } catch (error) {
    if (listRequest !== request) return;
    if (error.status === 401) setLogin();
    else if (panel.hidden) setLogin(error.message);
    else loadFailure = { target, change, message: target ? 'No pudimos cargar más pedidos.' : 'No pudimos cargar los pedidos.' };
  } finally {
    if (listRequest === request) {
      listRequest = undefined;
      loading = false;
      if (!target) {
        refresh.disabled = false;
        refresh.setAttribute('aria-busy', 'false');
        logout.disabled = exporting;
      }
      results.setAttribute('aria-busy', 'false');
      updateFeed();
      updateSelection();
    }
  }
}

function showMeasures() {
  const preset = catalog.medidas[form.elements.mercaderia.value];
  const values = form.elements.modo.value === 'personalizado'
    ? customMeasures.map(field => field.valueAsNumber)
    : preset ? measureUnits(preset) : [];
  measureKeys.forEach((key, index) => {
    const value = values[index];
    const valid = Number.isFinite(value) && (index === 3 ? value >= 0 : value > 0);
    const unit = index < 3 ? 'cm' : 'kg';
    byId(`vista-${key}`).textContent = valid ? `${measureFormat.format(value)} ${unit}` : '—';
  });
  drawPackage(values.length ? values : null);
}

function switchMeasureMode() {
  const custom = form.elements.modo.value === 'personalizado';
  byId('medidas-personalizadas').hidden = !custom;
  customMeasures.forEach(field => { field.disabled = !custom || Boolean(draft?.despachado_en); });
  byId('etiqueta-mercaderia').textContent = custom ? 'Tipo de mercadería en Shalom' : 'Tamaño de Shalom';
  form.elements.mercaderia.options[0].textContent = custom ? 'Selecciona un tipo de mercadería' : 'Selecciona un tamaño';
  showMeasures();
}

function editOrder(order) {
  if (loading) return;
  draft = order;
  const sent = Boolean(order.despachado_en);
  byId('pedido-codigo').textContent = order.codigo;
  byId('titulo-preparacion').textContent = sent ? 'Detalle del despacho' : hasPackage(order) ? 'Editar bulto' : 'Preparar bulto';
  byId('pedido-estado').replaceChildren(timeline(order));
  byId('pedido-agencia').textContent = `${order.agencia} · ${order.shalom_ubicacion || order.departamento}`;
  byId('pedido-direccion').textContent = order.direccion;
  byId('pedido-destinatario').textContent = order.nombre;
  byId('pedido-documento').textContent = `DNI ${order.dni} · ${phoneLabel(order.celular)}`;
  byId('destino-no-exportable').hidden = Boolean(order.shalom_destino);
  const [first, ...others] = packagesOf(order);
  form.elements.mercaderia.value = first?.mercaderia || '';
  form.elements.cantidad.value = first?.cantidad ?? 1;
  byId('modo-medidas').disabled = sent;
  form.elements.mercaderia.disabled = sent;
  form.elements.cantidad.disabled = sent;
  editorSave.hidden = sent;
  editorCancel.textContent = sent ? 'Cerrar' : 'Cancelar';
  const measures = first?.medidas;
  form.elements.modo.value = measures ? 'personalizado' : 'estandar';
  const customValues = measures ? measureUnits(measures) : [];
  customMeasures.forEach((field, index) => { field.value = customValues[index] ?? ''; });
  extraPackages?.dispose();
  extraPackages = createPackageList(byId('bultos-adicionales'), catalog, order.codigo);
  for (const bundle of others) extraPackages.add(bundle, { readOnly: sent });
  byId('agregar-bulto').hidden = sent;
  status('error-envio');
  switchMeasureMode();
  dialog.showModal();
}

function confirmShipment(order) {
  if (loading) return;
  shipment = order;
  byId('codigo-despacho').textContent = order.codigo;
  status('error-despacho');
  shipmentPackages?.dispose();
  shipmentPackages = createPackageList(byId('bultos-despacho'), catalog, order.codigo);
  for (const bundle of packagesOf(order)) shipmentPackages.add(bundle, { readOnly: true });
  shipmentDialog.showModal();
}

function confirmDeletion(targets) {
  if (loading || filterTimer || !targets.length) return;
  if (targets.length > maxBatchOrders) {
    status('error-seleccion', `Selecciona hasta ${maxBatchOrders} pedidos para eliminar por vez.`, true);
    return;
  }
  deletionCodes = targets.map(order => order.codigo);
  const single = targets.length === 1;
  byId('resumen-eliminacion').textContent = single ? '1 pedido' : `${targets.length} pedidos seleccionados`;
  byId('titulo-eliminacion').textContent = single ? 'Eliminar pedido' : 'Eliminar pedidos';
  byId('detalle-eliminacion').textContent = single ? 'Este pedido se borrará del panel de forma permanente.' :
    'Estos pedidos se borrarán del panel de forma permanente.';
  byId('lista-eliminacion').replaceChildren(...targets.map(order => {
    const item = document.createElement('li');
    const code = document.createElement('strong');
    const details = document.createElement('span');
    const stage = stages.find(([key]) => key === orderStage(order))[1];
    code.textContent = order.codigo;
    details.textContent = `${order.nombre} · ${stage}`;
    item.append(code, details);
    return item;
  }));
  deletionSave.textContent = single ? 'Eliminar pedido' : `Eliminar ${targets.length} pedidos`;
  status('error-eliminacion');
  deletionDialog.showModal();
}

function removeListedOrder(codigo) {
  orders.delete(codigo);
  selected.delete(codigo);
  byId(codigo)?.remove();
}

function updateOrders(pedidos) {
  for (const pedido of pedidos) {
    const previous = orders.get(pedido.codigo);
    if (!previous) continue;
    const row = byId(pedido.codigo);
    if (filterStage && orderStage(pedido) !== filterStage) {
      removeListedOrder(pedido.codigo);
      continue;
    }
    orders.set(pedido.codigo, pedido);
    if (selected.has(pedido.codigo)) selected.set(pedido.codigo, pedido);
    row.replaceWith(renderOrder(pedido));
  }
  status('error-seleccion');
  updateFeed();
  updateSelection();
}

function updateOrder(pedido) {
  updateOrders([pedido]);
  (byId(pedido.codigo)?.querySelector('.row-actions button') ?? search).focus({ preventScroll: true });
}

function openBatch(action) {
  if (loading) return;
  const candidates = [...selected.values()].filter(action === 'preparar' ? canPrepare : isReady);
  if (candidates.length > maxBatchOrders) {
    status('error-seleccion', `Selecciona hasta ${maxBatchOrders} pedidos por lote.`, true);
    return;
  }
  if (candidates.length) batchEditor.open(action, candidates, catalog);
}

async function saveBatch(action, batch) {
  try {
    const { pedidos, conflictos } = await api('lote', {
      method: 'PATCH', body: JSON.stringify({ accion: action, pedidos: batch }),
    });
    if (pedidos.length) {
      updateOrders(pedidos);
      const noun = pedidos.length === 1 ? 'pedido' : 'pedidos';
      const state = action === 'preparar' ? 'preparado' : 'enviado';
      status('estado-panel', `${pedidos.length} ${noun} ${state}${pedidos.length === 1 ? '' : 's'}.`);
    }
    return conflictos;
  } catch (error) {
    if (error.status === 401) setLogin('La sesión venció. Vuelve a ingresar.');
    throw error;
  }
}

login.addEventListener('submit', async event => {
  event.preventDefault();
  if (loginSubmit.disabled) return;
  const label = loginSubmit.querySelector('.login-submit-label');
  const liveStatus = byId('estado-login');
  loginSubmit.disabled = true;
  loginSubmit.setAttribute('aria-busy', 'true');
  label.textContent = 'Ingresando…';
  liveStatus.textContent = 'Verificando acceso.';
  status('error-login');
  const credentials = Object.fromEntries(new FormData(login));
  try {
    await api('sesion', { method: 'POST', body: JSON.stringify(credentials) });
    login.reset();
    setPasswordVisible(false);
    await loadOrders();
  } catch (error) {
    status('error-login', error.message, true);
  } finally {
    loginSubmit.disabled = false;
    loginSubmit.removeAttribute('aria-busy');
    label.textContent = 'Ingresar';
    liveStatus.textContent = '';
  }
});

logout.addEventListener('click', async () => {
  logout.disabled = true;
  try {
    await api('sesion', { method: 'DELETE' });
    setLogin();
    login.elements.usuario.focus();
  } catch (error) {
    status('estado-panel', error.message, true);
  } finally {
    logout.disabled = false;
  }
});

refresh.addEventListener('click', () => {
  clearTimeout(filterTimer);
  filterTimer = undefined;
  void loadOrders(null, 'refresh');
});
retryOrders.addEventListener('click', () => {
  if (loadFailure) void loadOrders(loadFailure.target, loadFailure.change);
});
search.addEventListener('input', () => {
  clearTimeout(filterTimer);
  updateFilterControls();
  filterTimer = setTimeout(applyFilters, 220);
});
byId('filtros-pedidos').addEventListener('submit', event => { event.preventDefault(); applyFilters(); });
regionFilter.addEventListener('change', () => { updateFilterControls(); applyFilters(); });
for (const button of stageButtons) {
  button.addEventListener('click', () => {
    if (filterStage === button.dataset.stage) return;
    filterStage = button.dataset.stage;
    updateFilterControls();
    applyFilters();
  });
}
for (const button of dateButtons) {
  button.addEventListener('click', () => {
    const { period } = button.dataset;
    if (period === 'rango') {
      showDateRange(dateRange.hidden);
      if (!dateRange.hidden) dateFrom.focus();
      return;
    }
    showDateRange(false);
    if (filterDate.period === period) return;
    filterDate = { period };
    updateFilterControls();
    applyFilters();
  });
}
dateRange.addEventListener('input', () => dateTo.setCustomValidity(''));
dateRange.addEventListener('submit', event => {
  event.preventDefault();
  if (dateFrom.value > dateTo.value) {
    dateTo.setCustomValidity('La fecha Hasta debe ser igual o posterior a Desde.');
    dateTo.reportValidity();
    return;
  }
  filterDate = { period: 'rango', from: dateFrom.value, to: dateTo.value };
  showDateRange(false);
  updateFilterControls();
  rangeToggle.focus();
  applyFilters();
});
clearDate.addEventListener('click', () => {
  resetDateFilter();
  updateFilterControls();
  dateButtons[0].focus();
  applyFilters();
});
byId('limpiar-filtros').addEventListener('click', () => {
  search.value = '';
  regionFilter.value = '';
  filterStage = '';
  resetDateFilter();
  updateFilterControls();
  search.focus();
  applyFilters();
});
all.addEventListener('change', () => {
  for (const order of orders.values()) {
    if (all.checked) selected.set(order.codigo, order);
    else selected.delete(order.codigo);
    byId(order.codigo).querySelector('.cell-select input').checked = all.checked;
  }
  status('error-seleccion');
  updateSelection();
});
prepareBatch.addEventListener('click', () => openBatch('preparar'));
sendBatch.addEventListener('click', () => openBatch('enviar'));
deleteBatch.addEventListener('click', () => confirmDeletion([...selected.values()]));
clearBatch.addEventListener('click', () => {
  for (const code of selected.keys()) byId(code).querySelector('.cell-select input').checked = false;
  selected.clear();
  status('error-seleccion');
  updateSelection();
  results.focus({ preventScroll: true });
});
byId('lote-pedidos').addEventListener('close', () => {
  if (!panel.hidden && document.activeElement === document.body) results.focus({ preventScroll: true });
});

byId('mercaderia').addEventListener('change', showMeasures);
form.querySelector('.measure-mode').addEventListener('change', switchMeasureMode);
customMeasures.forEach(field => field.addEventListener('input', showMeasures));
byId('agregar-bulto').addEventListener('click', () => extraPackages.add({}, { focus: true }));
editorCancel.addEventListener('click', () => dialog.close());
editorClose.addEventListener('click', () => dialog.close());
shipmentCancel.addEventListener('click', () => shipmentDialog.close());
shipmentDialog.addEventListener('cancel', event => { if (shipmentSave.disabled) event.preventDefault(); });
shipmentDialog.addEventListener('close', () => {
  if (shipmentDialog.open) return;
  shipmentPackages?.dispose();
  shipment = undefined;
});
shipmentSave.addEventListener('click', async () => {
  if (!shipment || shipmentSave.disabled) return;
  const { codigo } = shipment;
  shipmentSave.disabled = true;
  shipmentCancel.disabled = true;
  shipmentSave.textContent = 'Registrando…';
  status('error-despacho');
  try {
    const { pedido } = await api('despacho', { method: 'PATCH', body: JSON.stringify({ codigo }) });
    shipmentDialog.close();
    updateOrder(pedido);
    status('estado-panel', `${codigo} marcado como enviado.`);
  } catch (error) {
    if (error.status === 401) setLogin('La sesión venció. Vuelve a ingresar.');
    else status('error-despacho', error.message, true);
  } finally {
    shipmentSave.disabled = false;
    shipmentCancel.disabled = false;
    shipmentSave.textContent = 'Confirmar envío';
  }
});
deletionCancel.addEventListener('click', () => deletionDialog.close());
deletionDialog.addEventListener('cancel', event => { if (deletionSave.disabled) event.preventDefault(); });
deletionDialog.addEventListener('close', () => {
  if (deletionDialog.open) return;
  deletionCodes = [];
  byId('lista-eliminacion').replaceChildren();
});
deletionSave.addEventListener('click', async () => {
  if (!deletionCodes.length || deletionSave.disabled) return;
  const codes = deletionCodes;
  const single = codes.length === 1;
  const label = deletionSave.textContent;
  deletionSave.disabled = true;
  deletionCancel.disabled = true;
  deletionSave.textContent = 'Eliminando…';
  status('error-eliminacion');
  try {
    await api('pedidos', { method: 'DELETE', body: JSON.stringify({ pedidos: codes }) });
    const row = single ? byId(codes[0]) : null;
    const neighbor = row?.nextElementSibling ?? row?.previousElementSibling;
    deletionDialog.close();
    for (const codigo of codes) removeListedOrder(codigo);
    status('error-seleccion');
    updateFeed();
    updateSelection();
    status('estado-panel', single ? `Pedido ${codes[0]} eliminado.` : `${codes.length} pedidos eliminados.`);
    (neighbor?.querySelector('.row-actions button') ?? (results.hidden ? search : results)).focus({ preventScroll: true });
  } catch (error) {
    if (error.status === 401) setLogin('La sesión venció. Vuelve a ingresar.');
    else status('error-eliminacion', error.status ? error.message : 'No se pudo completar la eliminación. Vuelve a intentarlo.', true);
  } finally {
    deletionSave.disabled = false;
    deletionCancel.disabled = false;
    deletionSave.textContent = label;
  }
});
dialog.addEventListener('cancel', event => {
  if (editorSave.disabled) event.preventDefault();
});
dialog.addEventListener('close', () => {
  if (dialog.open) return;
  for (const id of ['pedido-agencia', 'pedido-direccion', 'pedido-destinatario', 'pedido-documento', 'pedido-codigo']) {
    byId(id).textContent = '';
  }
  byId('pedido-estado').replaceChildren();
  extraPackages?.dispose();
  draft = undefined;
});

form.addEventListener('submit', async event => {
  event.preventDefault();
  if (!draft || draft.despachado_en || editorSave.disabled) return;
  const fields = Object.fromEntries(new FormData(form));
  const medidas = fields.modo === 'personalizado'
    ? customMeasures.map((field, index) => field.valueAsNumber / (index < 3 ? 100 : 1))
    : null;
  editorSave.disabled = true;
  editorSave.querySelector('span').textContent = 'Guardando…';
  editorCancel.disabled = true;
  editorClose.disabled = true;
  status('error-envio');
  try {
    const bultos = [{ mercaderia: fields.mercaderia, cantidad: Number(fields.cantidad), medidas }, ...extraPackages.read()];
    const { pedido } = await api('pedidos', {
      method: 'PATCH', body: JSON.stringify({ codigo: draft.codigo, bultos }),
    });
    dialog.close();
    updateOrder(pedido);
    status('estado-panel', `Preparación de ${pedido.codigo} guardada.`);
  } catch (error) {
    if (error.status === 401) setLogin('La sesión venció. Vuelve a ingresar.');
    else status('error-envio', error.message, true);
  } finally {
    editorSave.disabled = false;
    editorSave.querySelector('span').textContent = 'Guardar bulto';
    editorCancel.disabled = false;
    editorClose.disabled = false;
  }
});

exportButton.addEventListener('click', () => {
  const batch = [...selected.values()].filter(isReady);
  if (!batch.length) return;
  const rowCount = batch.reduce((total, order) => total + packagesOf(order).length, 0);
  if (rowCount > catalog.maximo) {
    status('error-seleccion', `La selección necesita ${rowCount} filas. La plantilla admite ${catalog.maximo} por archivo.`, true);
    return;
  }
  exportReview.open(batch, catalog.origenes, rowCount);
});

async function downloadReviewedExcel(batch) {
  exporting = true;
  logout.disabled = true;
  updateSelection();
  try {
    const { pedidos } = await api('exportacion', {
      method: 'PATCH', body: JSON.stringify(batch),
    });
    updateOrders(pedidos);
    const file = await exportShalom(pedidos, batch.origen, catalog);
    const link = document.createElement('a');
    const url = URL.createObjectURL(file);
    link.href = url;
    link.download = `Shalom-Pro-YIWU-${fileDate.format(new Date())}.xlsx`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
    status('estado-panel', pedidos.length === 1 ? 'Excel con 1 pedido descargado.' : `Excel con ${pedidos.length} pedidos descargado.`);
  } catch (error) {
    if (error.status === 401) setLogin('La sesión venció. Vuelve a ingresar.');
    throw error;
  } finally {
    exporting = false;
    logout.disabled = false;
    updateSelection();
  }
}

const ordersObserver = new IntersectionObserver(entries => {
  if (nextCursor && !loadFailure && entries.some(entry => entry.isIntersecting)) void loadOrders(nextCursor);
}, { rootMargin: '0px 0px 240px' });

loadOrders();
