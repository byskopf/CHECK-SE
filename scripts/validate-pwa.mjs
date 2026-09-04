import { access, readFile } from 'node:fs/promises';
import { constants } from 'node:fs';

const requiredFiles = [
  'index.html',
  'app.html',
  'app.js',
  'styles.css',
  'manifest.json',
  'sw.js',
  'offline.html',
  'favicon.svg',
  'icon-192.png',
  'icon-512.png',
  'icon-maskable-192.png',
  'icon-maskable-512.png',
  'apple-touch-icon.png',
];

const failures = [];

for (const file of requiredFiles) {
  try {
    await access(file, constants.R_OK);
  } catch {
    failures.push(`Arquivo obrigatório ausente ou ilegível: ${file}`);
  }
}

let manifest;
try {
  manifest = JSON.parse(await readFile('manifest.json', 'utf8'));
} catch (error) {
  failures.push(`manifest.json inválido: ${error.message}`);
}

if (manifest) {
  for (const field of ['name', 'short_name', 'start_url', 'scope', 'display', 'icons']) {
    if (manifest[field] === undefined || manifest[field] === '') {
      failures.push(`Campo obrigatório ausente no manifest.json: ${field}`);
    }
  }

  if (!Array.isArray(manifest.icons) || manifest.icons.length === 0) {
    failures.push('manifest.json deve declarar pelo menos um ícone.');
  } else {
    for (const icon of manifest.icons) {
      if (!icon.src || !icon.sizes || !icon.type) {
        failures.push('Cada ícone do manifest.json deve ter src, sizes e type.');
        continue;
      }
      try {
        await access(icon.src.replace(/^\.\//, ''), constants.R_OK);
      } catch {
        failures.push(`Ícone referenciado no manifest.json não encontrado: ${icon.src}`);
      }
    }
  }
}

const indexHtml = await readFile('index.html', 'utf8').catch(() => '');
for (const reference of ['manifest.json', 'app.js', 'styles.css']) {
  if (!indexHtml.includes(reference)) {
    failures.push(`index.html não referencia ${reference}.`);
  }
}

const serviceWorker = await readFile('sw.js', 'utf8').catch(() => '');
for (const file of ['index.html', 'app.js', 'styles.css', 'manifest.json', 'offline.html']) {
  if (!serviceWorker.includes(file)) {
    failures.push(`sw.js não referencia o arquivo essencial ${file}.`);
  }
}

if (failures.length > 0) {
  console.error('Validação do PWA falhou:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('PWA validado com sucesso.');
