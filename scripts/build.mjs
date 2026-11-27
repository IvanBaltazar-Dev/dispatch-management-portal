import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';

const source = new URL('../site/', import.meta.url);
const output = new URL('../dist/', import.meta.url);
const asset = name => new URL(name, output);

async function version(name) {
  return createHash('sha256').update(await readFile(asset(name))).digest('hex').slice(0, 12);
}

async function versionImports(name) {
  const file = asset(name);
  let source = await readFile(file, 'utf8');
  const dependencies = new Set([...source.matchAll(/from '(\.{1,2}\/[a-z][a-z0-9-]*\.js)'/g)].map(match => match[1]));
  for (const dependency of dependencies) {
    const tag = await version(new URL(dependency, file));
    source = source.replaceAll(`from '${dependency}'`, `from '${dependency}?v=${tag}'`);
  }
  await writeFile(file, source);
}

const phone = (process.env.YIWU_WHATSAPP_NUMBER ?? '').trim();
if (phone && !/^[1-9]\d{7,14}$/.test(phone)) {
  throw new Error('YIWU_WHATSAPP_NUMBER debe usar el formato internacional sin espacios ni signo +.');
}

// Los archivos admitidos en Git definen también los recursos que se publican.
const ignoreRules = await readFile(new URL('../.gitignore', import.meta.url), 'utf8');
const siteRulePrefix = '!/site/';
const siteFiles = ignoreRules.split(/\r?\n/)
  .filter(rule => rule.startsWith(siteRulePrefix) && !rule.endsWith('/'))
  .map(rule => rule.slice(siteRulePrefix.length));
for (const file of siteFiles) {
  await mkdir(new URL('./', asset(file)), { recursive: true });
  await copyFile(new URL(file, source), asset(file));
}
for (const file of ['formulario.js', 'panel/bultos.js', 'panel/lote.js', 'panel/revision-shalom.js', 'panel/shalom-export.js', 'panel/panel.js']) {
  await versionImports(file);
}

for (const [page, paths] of [
  ['index.html', ['formulario.css', 'formulario.js']],
  ['panel/index.html', ['/panel/panel.css', '/panel/panel.js']],
]) {
  let html = await readFile(asset(page), 'utf8');
  for (const path of paths) {
    const tag = await version(path.replace(/^\//, ''));
    html = html.replace(`"${path}"`, `"${path}?v=${tag}"`);
  }
  if (phone) {
    if (page === 'index.html') html = html.replace(/https:\/\/wa\.me\/[1-9]\d{7,14}\?text=/, `https://wa.me/${phone}?text=`);
    else html = html.replace('id="telefono-contacto" type="tel" value=""', `id="telefono-contacto" type="tel" value="+${phone}"`);
  }
  await writeFile(asset(page), html);
}

console.log('Sitio listo para publicar desde dist/');
