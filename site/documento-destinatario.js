const tiposPorLongitud = {
  8: 'DNI',
  9: 'Carné de extranjería',
  11: 'RUC',
};

export function tipoDocumento(documento) {
  return tiposPorLongitud[documento?.length] ?? 'Documento';
}
