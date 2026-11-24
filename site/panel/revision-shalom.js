import { originPicker } from './origen-picker.js';

const byId = id => document.getElementById(id);
const normalize = text => text.toUpperCase().normalize('NFD').replace(/\p{M}/gu, '')
  .replace(/[^A-Z0-9]+/g, ' ').trim();
const normalizeOrigin = name => normalize(name).replace(/\b(?:ANTONIO )?RA[IY]MONDI\b/g, 'RAYMONDI');
const originKey = 'yiwu-shalom-origen-habitual';
const phoneKey = 'yiwu-shalom-telefono-contacto';

function nationalPhone(value) {
  const number = value.replace(/[\s().-]/g, '').replace(/^\+51/, '').replace(/^51(?=\d{8,9}$)/, '');
  return /^[1-9]\d{7,8}$/.test(number) ? number : '';
}

export function createShalomReview(download) {
  const dialog = byId('revision-excel');
  const form = byId('form-revision-excel');
  const title = byId('titulo-revision-excel');
  const origin = byId('origen');
  const phone = byId('telefono-contacto');
  const dni = byId('documento-lote');
  const grr = byId('grr-lote');
  const submit = byId('descargar-excel');
  const cancel = byId('cancelar-revision-excel');
  const closeButton = byId('cerrar-revision-excel');
  const notice = byId('error-revision-excel');
  const picker = originPicker(origin, byId('menu-origen'), byId('lista-origenes'), byId('sin-origenes'), normalizeOrigin);
  let codes = [];
  let agencies = [];

  function showError(message = '') {
    notice.textContent = message;
    notice.hidden = !message;
  }

  function setBusy(busy) {
    for (const control of [origin, phone, dni, grr, submit, cancel, closeButton]) control.disabled = busy;
    form.setAttribute('aria-busy', String(busy));
    submit.querySelector('span').textContent = busy ? 'Preparando Excel…' : 'Descargar Excel';
  }

  function invalid(field, message) {
    field.setCustomValidity(message);
    field.reportValidity();
  }

  form.addEventListener('input', event => {
    event.target.setCustomValidity('');
    showError();
  });
  dni.addEventListener('paste', event => {
    const pasted = event.clipboardData?.getData('text');
    if (!pasted) return;
    const retained = dni.value.length - (dni.selectionEnd - dni.selectionStart);
    if (/^[0-9]+$/.test(pasted) && retained + pasted.length <= dni.maxLength) return;
    event.preventDefault();
    showError('Pega solo los dígitos del DNI, hasta completar 8.');
  });
  cancel.addEventListener('click', () => dialog.close());
  closeButton.addEventListener('click', () => dialog.close());
  dialog.addEventListener('cancel', event => {
    if (submit.disabled || !byId('menu-origen').hidden) event.preventDefault();
  });
  dialog.addEventListener('close', () => { if (!dialog.open) picker.close(); });

  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (submit.disabled || !codes.length) return;
    showError();
    const matching = agencies.filter(name => normalize(name) === normalize(origin.value));
    const agency = agencies.includes(origin.value) ? origin.value : matching.length === 1 ? matching[0] : '';
    if (!agency) return invalid(origin, 'Selecciona una agencia de origen de la lista.');
    const number = nationalPhone(phone.value);
    if (!number) return invalid(phone, 'Ingresa un teléfono peruano válido.');
    const document = dni.value.trim();
    if (!/^[0-9]{8}$/.test(document) || document === '00000000') {
      return invalid(dni, 'Ingresa los 8 dígitos del DNI de quien envía.');
    }
    const guide = grr.value.trim().toUpperCase().replace(/\s*-\s*/g, '-');
    if (guide && !/^[A-Z0-9]+-\d+$/.test(guide)) {
      return invalid(grr, 'Indica la serie y el número de la GRR, separados por un guion.');
    }
    picker.close();
    setBusy(true);
    try {
      await download({ origen: agency, telefono: number, documento: document, grr: guide, pedidos: codes });
      try { localStorage.setItem(originKey, agency); } catch { /* Origen seleccionado para este lote. */ }
      dialog.close();
    } catch (error) {
      if (dialog.open) showError(error.message || 'Vuelve a intentar la descarga.');
    } finally {
      setBusy(false);
    }
  });

  return {
    open(orders, origins, rowCount) {
      codes = orders.map(order => order.codigo);
      agencies = origins;
      picker.setOptions(agencies);
      form.reset();
      for (const field of [origin, phone, dni, grr]) field.setCustomValidity('');
      try {
        const preferredOrigin = localStorage.getItem(originKey);
        if (agencies.includes(preferredOrigin)) origin.value = preferredOrigin;
        const preferredPhone = localStorage.getItem(phoneKey) ?? '';
        if (nationalPhone(preferredPhone)) phone.value = preferredPhone;
      } catch { /* Se conservan los valores del formulario. */ }
      const count = codes.length === 1 ? '1 pedido seleccionado' : `${codes.length} pedidos seleccionados`;
      byId('resumen-revision-excel').textContent = rowCount === codes.length ? count : `${count} · ${rowCount} filas en el Excel`;
      showError();
      setBusy(false);
      dialog.showModal();
      title.focus();
    },
    close() { if (dialog.open) dialog.close(); },
  };
}
