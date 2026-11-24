import { createPackageList, packagesOf } from './bultos.js';

const byId = id => document.getElementById(id);
const actions = {
  preparar: ['Preparar lote', 'Indica cuántos bultos hay de cada tamaño. Si un pedido combina tamaños, añade otro.', 'Guardar preparación', 'Guardando…'],
  enviar: ['Marcar lote como enviado', 'Confirma que estos pedidos ya fueron entregados a Shalom.', 'Confirmar envíos', 'Registrando…'],
};

export function createBatchEditor(save) {
  const dialog = byId('lote-pedidos');
  const form = byId('form-lote');
  const list = byId('lista-lote');
  const common = byId('tipo-lote');
  const apply = byId('aplicar-tipo-lote');
  const submit = byId('guardar-lote');
  const cancel = byId('cancelar-lote');
  const closeButton = byId('cerrar-lote');
  const notice = byId('error-lote');
  let action;
  let catalog;
  let entries = [];

  function setNotice(message = '') {
    notice.textContent = message;
    notice.hidden = !message;
  }

  function removeEntry(entry) {
    entry.groups.dispose();
    entry.row.remove();
  }

  function renderEntry(order) {
    const row = document.createElement('li');
    row.className = 'batch-item';
    const heading = document.createElement('div');
    heading.className = 'batch-order';
    const code = document.createElement('strong');
    code.textContent = order.codigo;
    const details = document.createElement('span');
    details.textContent = `${order.nombre} · ${order.agencia}`;
    const host = document.createElement('div');
    host.className = 'package-groups';
    const groups = createPackageList(host, catalog, order.codigo);
    heading.append(code, details);
    row.append(heading, host);
    if (action === 'enviar') {
      for (const bundle of packagesOf(order)) groups.add(bundle, { readOnly: true });
    } else {
      const add = document.createElement('button');
      add.type = 'button';
      add.className = 'button ghost add-package';
      add.textContent = 'Añadir otro tamaño';
      add.setAttribute('aria-label', `Añadir otro tamaño a ${order.codigo}`);
      add.addEventListener('click', () => groups.add({}, { focus: true }));
      heading.append(add);
      groups.add({}, { removable: false });
    }
    return { order, row, groups };
  }

  function updateCount() {
    byId('resumen-lote').textContent = `${entries.length} ${entries.length === 1 ? 'pedido' : 'pedidos'}`;
  }

  function setBusy(busy) {
    submit.disabled = busy;
    cancel.disabled = busy;
    closeButton.disabled = busy;
    common.disabled = busy;
    apply.disabled = busy || !common.value;
    list.inert = busy;
    form.setAttribute('aria-busy', String(busy));
    submit.textContent = actions[action][busy ? 3 : 2];
  }

  closeButton.addEventListener('click', () => dialog.close());
  cancel.addEventListener('click', () => dialog.close());
  dialog.addEventListener('cancel', event => { if (submit.disabled) event.preventDefault(); });
  dialog.addEventListener('close', () => {
    if (dialog.open) return;
    entries.forEach(removeEntry);
    entries = [];
    setNotice();
  });
  common.addEventListener('change', () => { apply.disabled = !common.value; });
  apply.addEventListener('click', () => {
    for (const entry of entries) entry.groups.setFirstType(common.value);
  });
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (submit.disabled || !entries.length) return;
    const payload = entries.map(({ order, groups }) => ({
      codigo: order.codigo,
      ...(action === 'preparar' && { bultos: groups.read() }),
    }));
    setNotice();
    setBusy(true);
    try {
      const conflicts = new Set(await save(action, payload));
      if (!conflicts.size) {
        dialog.close();
        return;
      }
      entries = entries.filter(entry => {
        if (conflicts.has(entry.order.codigo)) {
          if (!entry.row.classList.contains('batch-conflict')) {
            entry.row.classList.add('batch-conflict');
            const warning = document.createElement('p');
            warning.className = 'batch-conflict-label';
            warning.textContent = 'Revisa el estado de este pedido.';
            entry.row.append(warning);
          }
          return true;
        }
        removeEntry(entry);
        return false;
      });
      updateCount();
      setNotice(`Quedaron ${entries.length} ${entries.length === 1 ? 'pedido pendiente' : 'pedidos pendientes'}. Actualiza el listado para revisar los pedidos señalados.`);
    } catch (error) {
      if (dialog.open) setNotice(error.message || 'Intenta guardar el lote nuevamente.');
    } finally {
      setBusy(false);
    }
  });

  return {
    open(nextAction, orders, source) {
      action = nextAction;
      catalog = source;
      const [title, instruction] = actions[action];
      byId('titulo-lote').textContent = title;
      byId('instruccion-lote').textContent = instruction;
      byId('tipo-compartido').hidden = action !== 'preparar';
      common.replaceChildren(new Option('Selecciona un tamaño', ''), ...catalog.mercaderias.map(type => new Option(type, type)));
      entries.forEach(removeEntry);
      entries = orders.map(renderEntry);
      list.replaceChildren(...entries.map(entry => entry.row));
      updateCount();
      setNotice();
      setBusy(false);
      dialog.showModal();
      if (action === 'preparar') common.focus();
      else cancel.focus();
    },
    close() { if (dialog.open) dialog.close(); },
  };
}
