import { packagesOf } from './bultos.js';

const worksheetName = 'xl/worksheets/sheet1.xml';
const stringTableName = 'xl/sharedStrings.xml';
const mime = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const xmlDeclaration = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';

function writeText(sheet, cell, value, strings, indices) {
  if (!value) return;
  if (!indices.has(value)) {
    const root = strings.documentElement;
    const item = strings.createElementNS(root.namespaceURI, 'si');
    const text = strings.createElementNS(root.namespaceURI, 't');
    text.setAttributeNS('http://www.w3.org/XML/1998/namespace', 'xml:space', 'preserve');
    text.textContent = value;
    item.append(text);
    const count = root.getElementsByTagName('si').length;
    indices.set(value, count);
    root.append(item);
    root.setAttribute('uniqueCount', String(count + 1));
  }
  const index = sheet.createElementNS(cell.namespaceURI, 'v');
  index.textContent = String(indices.get(value));
  cell.setAttribute('t', 's');
  cell.replaceChildren(index);
}

function writeNumber(sheet, cell, value, replaceFormula = false) {
  if (replaceFormula) cell.getElementsByTagName('f')[0]?.remove();
  const cachedValue = cell.getElementsByTagName('v')[0] ?? sheet.createElementNS(cell.namespaceURI, 'v');
  cachedValue.textContent = String(value);
  cell.removeAttribute('t');
  if (!cachedValue.parentNode) cell.append(cachedValue);
}

export async function exportShalom(pedidos, origen, catalogo) {
  const lines = pedidos.flatMap(order => packagesOf(order).map(bundle => ({ order, bundle })));
  if (!lines.length || !catalogo.origenes.includes(origen)) {
    throw new Error('Revisa el origen y los pedidos seleccionados.');
  }
  if (lines.length > catalogo.maximo) throw new Error(`La plantilla admite ${catalogo.maximo} filas por archivo.`);
  const origenRestringido = catalogo.origenesSoloPrimerasFilas.includes(origen);
  const needsExpandedList = ({ order }) => origenRestringido || catalogo.destinosSoloPrimerasFilas.includes(order.shalom_destino);
  const expanded = lines.filter(needsExpandedList);
  if (expanded.length > catalogo.primerasFilas) {
    throw new Error(`La plantilla admite ${catalogo.primerasFilas} filas por archivo para esas agencias. Divide la selección en lotes.`);
  }
  // Las primeras filas tienen acceso a todas las agencias del catálogo de Shalom.
  const batch = [...expanded, ...lines.filter(line => !needsExpandedList(line))];
  const response = await fetch('/panel/shalom-base.xlsx');
  if (!response.ok) throw new Error('No se pudo abrir la plantilla de Shalom Pro.');
  const zip = await window.JSZip.loadAsync(await response.arrayBuffer());
  const xml = await Promise.all([worksheetName, stringTableName].map(name => zip.file(name).async('string')));
  const parser = new DOMParser();
  const [sheet, strings] = xml.map(source => parser.parseFromString(source, 'application/xml'));
  if ([sheet, strings].some(document => document.querySelector('parsererror'))) {
    throw new Error('La plantilla de Shalom Pro no es válida.');
  }
  const indices = new Map(Array.from(strings.getElementsByTagName('si'), (item, index) => [item.textContent, index]));
  const rows = sheet.getElementsByTagName('row');

  batch.forEach(({ order, bundle }, index) => {
    const measures = bundle.medidas ?? catalogo.medidas[bundle.mercaderia];
    if (!/^[0-9]{8}$/.test(order.shalom_contacto_doc ?? '') || order.shalom_contacto_doc === '00000000' ||
        !/^[1-9]\d{7,8}$/.test(order.shalom_contacto_telefono ?? '')) {
      throw new Error(`Completa los datos de contacto del pedido ${order.codigo}.`);
    }
    if (!Array.isArray(measures) || measures.length !== 4 || !measures.every(Number.isFinite) ||
        !catalogo.mercaderias.includes(bundle.mercaderia) || !catalogo.destinos.includes(order.shalom_destino) ||
        !Number.isInteger(bundle.cantidad) || bundle.cantidad < 1) {
      throw new Error(`Completa la preparación del pedido ${order.codigo}.`);
    }

    const rowNumber = index + 2;
    const row = rows[index + 1];
    if (row?.getAttribute('r') !== String(rowNumber)) throw new Error('La plantilla tiene filas inesperadas.');
    const cells = Object.fromEntries(Array.from(row.getElementsByTagName('c'), cell => [cell.getAttribute('r'), cell]));
    const values = [order.dni, order.celular, order.shalom_contacto_doc, order.shalom_contacto_telefono, order.shalom_grr,
      origen, order.shalom_destino, bundle.mercaderia, ...measures, bundle.cantidad];
    values.forEach((value, column) => {
      const cell = cells[`${String.fromCharCode(65 + column)}${rowNumber}`];
      if (!cell) throw new Error('Falta una columna en la plantilla.');
      if (column < 8) writeText(sheet, cell, value, strings, indices);
      else writeNumber(sheet, cell, value, Boolean(bundle.medidas) && column < 12);
    });
  });

  const serializer = new XMLSerializer();
  zip.file(worksheetName, xmlDeclaration + serializer.serializeToString(sheet.documentElement));
  zip.file(stringTableName, xmlDeclaration + serializer.serializeToString(strings.documentElement));
  return zip.generateAsync({ type: 'blob', mimeType: mime, compression: 'DEFLATE' });
}
