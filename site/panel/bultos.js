import { createPackagePreview } from './paquete-3d.js';

const format = new Intl.NumberFormat('es-PE', { maximumFractionDigits: 2 });
const previews = new WeakMap();
const observer = new IntersectionObserver(changes => {
  for (const change of changes) {
    const entry = previews.get(change.target);
    if (!change.isIntersecting || !entry?.metrics) continue;
    observer.unobserve(change.target);
    entry.draw = createPackagePreview(change.target, { compact: true });
    entry.draw(entry.metrics);
  }
});

export function packagesOf(order) {
  if (order.shalom_bultos?.length) return order.shalom_bultos;
  return order.shalom_mercaderia && order.shalom_cantidad
    ? [{ mercaderia: order.shalom_mercaderia, cantidad: order.shalom_cantidad, medidas: order.shalom_medidas }]
    : [];
}

export function showPackageMeasures(values) {
  return values.map((value, index) => index < 3 ? Number((value * 100).toFixed(8)) : value);
}

function appendPreview(line, catalog) {
  const figure = document.createElement('figure');
  figure.className = 'batch-inline-preview';
  figure.setAttribute('aria-label', 'Medidas del bulto');
  const canvas = document.createElement('canvas');
  canvas.setAttribute('aria-hidden', 'true');
  const caption = document.createElement('figcaption');
  figure.append(canvas, caption);
  line.append(figure);
  const entry = { metrics: null, draw: null };
  previews.set(canvas, entry);
  return {
    update({ mercaderia, medidas }) {
      const source = medidas ?? catalog.medidas[mercaderia];
      const metrics = source ? showPackageMeasures(source) : [];
      const valid = metrics.length === 4 && metrics.every((value, index) =>
        Number.isFinite(value) && (index === 3 ? value >= 0 : value > 0));
      figure.hidden = !valid;
      entry.metrics = valid ? metrics : null;
      caption.textContent = valid
        ? `${metrics.slice(0, 3).map(value => format.format(value)).join(' × ')} cm · ${format.format(metrics[3])} kg`
        : '';
      if (!valid) return;
      if (entry.draw) entry.draw(metrics);
      else observer.observe(canvas);
    },
    dispose() {
      observer.unobserve(canvas);
      previews.delete(canvas);
      entry.draw?.dispose?.();
    },
  };
}

export function createPackageList(host, catalog, reference) {
  const template = document.getElementById('fila-preparacion-lote');
  const entries = [];

  function add(bundle = {}, { removable = true, readOnly = false, focus = false } = {}) {
    if (readOnly) {
      const summary = document.createElement('div');
      summary.className = 'package-line package-readonly';
      const description = document.createElement('p');
      description.textContent = `${bundle.mercaderia} · ${bundle.cantidad} ${bundle.cantidad === 1 ? 'bulto' : 'bultos'}`;
      summary.append(description);
      const preview = appendPreview(summary, catalog);
      host.append(summary);
      preview.update(bundle);
      entries.push({ line: summary, preview, read: () => bundle });
      return;
    }

    const line = template.content.firstElementChild.cloneNode(true);
    const type = line.querySelector('select');
    const quantity = line.querySelector('[name=cantidad]');
    const custom = line.querySelector('.batch-custom');
    const dimensions = [...custom.querySelectorAll('input')];
    const toggle = line.querySelector('.batch-measure-toggle');
    const remove = line.querySelector('.remove-package');
    line.querySelector('legend').textContent = `Tamaño y bultos · ${reference}`;
    for (const field of line.querySelectorAll('[name]')) field.removeAttribute('name');
    type.append(...catalog.mercaderias.map(value => new Option(value, value)));
    type.value = bundle.mercaderia ?? '';
    quantity.value = bundle.cantidad ?? 1;
    const preview = appendPreview(line, catalog);

    const read = () => ({
      mercaderia: type.value,
      cantidad: quantity.valueAsNumber,
      medidas: custom.hidden ? null : dimensions.map((input, index) => input.valueAsNumber / (index < 3 ? 100 : 1)),
    });
    const update = () => preview.update(read());
    function toggleMeasures(enabled, source = catalog.medidas[type.value]) {
      custom.hidden = !enabled;
      toggle.setAttribute('aria-expanded', String(enabled));
      const defaults = source ? showPackageMeasures(source) : [];
      dimensions.forEach((input, index) => {
        input.disabled = !enabled;
        if (enabled && !input.value && defaults[index] !== undefined) input.value = defaults[index];
      });
      update();
    }
    const entry = { line, type, preview, read, update };
    remove.hidden = !removable;
    remove.addEventListener('click', () => {
      const index = entries.indexOf(entry);
      entries[index === 0 ? 1 : index - 1]?.type?.focus();
      entries.splice(index, 1);
      preview.dispose();
      line.remove();
    });
    toggle.addEventListener('click', () => toggleMeasures(custom.hidden));
    line.addEventListener('input', update);
    line.addEventListener('change', update);
    entries.push(entry);
    host.append(line);
    toggleMeasures(Boolean(bundle.medidas), bundle.medidas ?? undefined);
    if (focus) type.focus();
  }

  return {
    add,
    read: () => entries.map(entry => entry.read()),
    setFirstType(type) {
      const first = entries[0];
      if (!first?.type) return;
      first.type.value = type;
      first.update();
    },
    dispose() {
      for (const { line, preview } of entries) {
        preview.dispose();
        line.remove();
      }
      entries.length = 0;
    },
  };
}
