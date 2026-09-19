import { access, readFile } from 'node:fs/promises';
import { constants } from 'node:fs';

const requiredFiles = [
  'index.html',
  'app.html',
  'app-config.js',
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
  'og-check-se-whatsapp.jpg',
];

const failures = [];

const iconAssetPath = (src) => String(src || '').split(/[?#]/)[0].replace(/^\.\//, '');
const iconVersionOf = (src) => {
  try {
    return new URL(String(src || ''), 'https://pwa.local/').searchParams.get('v');
  } catch {
    return null;
  }
};

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
  for (const field of ['id', 'name', 'short_name', 'start_url', 'scope', 'display', 'icons']) {
    if (manifest[field] === undefined || manifest[field] === '') {
      failures.push(`Campo obrigatório ausente no manifest.json: ${field}`);
    }
  }

  if (!['./', '/CHECK-SE/'].includes(manifest.id) || !['./', '/CHECK-SE/'].includes(manifest.scope)) {
    failures.push('O CHECK-SE deve manter identidade e escopo próprios.');
  }

  if (manifest.display !== 'standalone') {
    failures.push('O CHECK-SE deve continuar instalável em modo standalone.');
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
        await access(iconAssetPath(icon.src), constants.R_OK);
      } catch {
        failures.push(`Ícone referenciado no manifest.json não encontrado: ${icon.src}`);
      }
    }
  }
}

const indexHtml = await readFile('index.html', 'utf8').catch(() => '');
for (const reference of ['manifest.json', 'app-config.js', 'app.js', 'styles.css']) {
  if (!indexHtml.includes(reference)) {
    failures.push(`index.html não referencia ${reference}.`);
  }
}

const serviceWorker = await readFile('sw.js', 'utf8').catch(() => '');
for (const file of ['index.html', 'app-config.js', 'app.js', 'styles.css', 'manifest.json', 'offline.html']) {
  if (!serviceWorker.includes(file)) {
    failures.push(`sw.js não referencia o arquivo essencial ${file}.`);
  }
}

const configSource = await readFile('app-config.js', 'utf8').catch(() => '');
const configVersion = configSource.match(/version:\s*['\"]([^'\"]+)['\"]/);
const configAppUrl = configSource.match(/appUrl:\s*['\"]([^'\"]+)['\"]/);
const configIconVersion = configSource.match(/iconVersion:\s*['"]([^'"]+)['"]/);
if (!configIconVersion || !/^[0-9A-Za-z._-]+$/.test(configIconVersion[1])) {
  failures.push('app-config.js deve declarar uma versão de ícones válida.');
}
if (manifest && configIconVersion) {
  const shortcutIcons = Array.isArray(manifest.shortcuts)
    ? manifest.shortcuts.flatMap((shortcut) => Array.isArray(shortcut.icons) ? shortcut.icons : [])
    : [];
  const declaredIcons = [
    ...(Array.isArray(manifest.icons) ? manifest.icons : []),
    ...shortcutIcons,
  ];
  for (const icon of declaredIcons) {
    if (iconVersionOf(icon.src) !== configIconVersion[1]) {
      failures.push('Todos os ícones do CHECK-SE devem usar ?v=' + configIconVersion[1] + ' para atualizar instalações existentes.');
      break;
    }
  }
  if (!indexHtml.includes('apple-touch-icon.png?v=' + configIconVersion[1])) {
    failures.push('O ícone Apple Touch deve usar a mesma versão de ícones.');
  }
}


if (!configVersion || !/^\d+\.\d+\.\d+$/.test(configVersion[1])) {
  failures.push('app-config.js deve declarar uma versão semântica válida.');
}

if (!configAppUrl) {
  failures.push('app-config.js deve declarar appUrl.');
} else {
  try {
    const parsed = new URL(configAppUrl[1]);
    if (parsed.protocol !== 'https:' || parsed.hostname !== 'script.google.com') {
      failures.push('appUrl deve ser uma URL HTTPS do script.google.com.');
    }
  } catch {
    failures.push('appUrl em app-config.js é inválida.');
  }
}

/* O atalho de quem JÁ instalou é um location.replace dentro de uma verificação de
   display-mode/standalone. A URL escrita ali é uma cópia solta do appUrl — e em 19/09/2026 essa
   cópia ficou para trás: o portal continuava abrindo a implantação antiga, que hoje serve a
   Central Administrativa em vez do aplicativo. Nada no validador pegava isso. Agora pega. */
const redirecionamentos = [...indexHtml.matchAll(/location\.(?:replace|assign)\(\s*["'](https:\/\/script\.google\.com[^"']*)["']/gi)];
if (redirecionamentos.length) {
  if (!/display-mode:\s*standalone|navigator\.standalone/i.test(indexHtml)) {
    failures.push('index.html só pode redirecionar ao Apps Script para quem já instalou (verificação de display-mode/standalone). Redirecionamento incondicional tira a instalação do ar.');
  }
  for (const achado of redirecionamentos) {
    if (configAppUrl && achado[1] !== configAppUrl[1]) {
      failures.push('A URL do redirecionamento em index.html está diferente do appUrl em app-config.js. Elas precisam ser iguais, senão o atalho de quem já instalou abre outra implantação.');
    }
  }
}

const packageJson = JSON.parse(await readFile('package.json', 'utf8').catch(() => '{}'));
if (configVersion && packageJson.version !== configVersion[1]) {
  failures.push('A versão do package.json deve ser igual à versão de app-config.js.');
}

const configScriptPosition = indexHtml.indexOf('app-config.js');
const appScriptPosition = indexHtml.indexOf('app.js');
if (configScriptPosition < 0 || appScriptPosition < 0 || configScriptPosition > appScriptPosition) {
  failures.push('index.html deve carregar app-config.js antes de app.js.');
}

const appJavaScript = await readFile('app.js', 'utf8').catch(() => '');
if (appJavaScript.includes('script.google.com/macros/s/')) {
  failures.push('app.js não deve repetir a URL do Apps Script; use app-config.js.');
}
if (!/updateViaCache\s*:\s*['"]none['"]/.test(appJavaScript)) {
  failures.push('O registro do Service Worker deve ignorar o cache HTTP ao procurar atualizações.');
}
if (/href=['"]https:\/\/script\.google\.com\/macros\/s\//i.test(indexHtml)) {
  failures.push('index.html não deve repetir a implantação do Apps Script; use app-config.js.');
}

if (!serviceWorker.includes('ICON_VERSION') || !serviceWorker.includes('iconVersion')) {
  failures.push('O Service Worker deve pré-carregar os ícones usando a versão configurada.');
}
const importedConfig = serviceWorker.match(/importScripts\(\s*['"]app-config\.js(?:\?v=([^'"]+))?['"]\s*\)/);
if (!importedConfig) {
  failures.push('sw.js deve importar app-config.js.');
}
if (importedConfig && importedConfig[1] && configVersion && importedConfig[1] !== configVersion[1]) {
  failures.push('A versão importada pelo sw.js deve corresponder à versão do app-config.js.');
}

/* A capa do compartilhamento pode trocar de nome (e deve, quando o conteúdo muda: WhatsApp e
   Facebook guardam a capa por URL). O que não pode é apontar para arquivo que não existe, nem
   as três tags divergirem entre si — aí o WhatsApp mostra uma capa e o Twitter outra. */
const ogImageMatch = indexHtml.match(/<meta\s+property=['\"]og:image['\"]\s+content=['\"]([^'\"]+)['\"]/i);
if (!ogImageMatch) {
  failures.push('index.html deve declarar og:image.');
} else {
  const arquivoDaCapa = ogImageMatch[1].split(/[?#]/)[0].split('/').pop();
  if (!await readFile(arquivoDaCapa).catch(() => null)) {
    failures.push('A capa declarada em og:image (' + arquivoDaCapa + ') não existe no repositório.');
  }
  for (const outra of ['property="og:image:secure_url"', 'name="twitter:image"']) {
    const m = indexHtml.match(new RegExp('<meta\\s+' + outra + '\\s+content=[\'\"]([^\'\"]+)[\'\"]', 'i'));
    if (!m || m[1] !== ogImageMatch[1]) {
      failures.push('A URL de ' + outra + ' deve ser igual à de og:image.');
    }
  }
}
for (const requiredMeta of [
  'property="og:image:type" content="image/jpeg"',
  'property="og:image:width" content="1200"',
  'property="og:image:height" content="630"',
]) {
  if (!indexHtml.includes(requiredMeta)) failures.push('Metadado obrigatório ausente: ' + requiredMeta);
}

function jpegDimensions(buffer) {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 8 < buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = buffer[offset + 1];
    const length = buffer.readUInt16BE(offset + 2);
    if (length < 2) return null;
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
      return { height: buffer.readUInt16BE(offset + 5), width: buffer.readUInt16BE(offset + 7) };
    }
    offset += 2 + length;
  }
  return null;
}

/* Confere a capa que está realmente em uso, não um nome fixo. */
const ogImage = ogImageMatch ? await readFile(ogImageMatch[1].split(/[?#]/)[0].split('/').pop()).catch(() => null) : null;
if (ogImage) {
  const dimensions = jpegDimensions(ogImage);
  if (!dimensions || dimensions.width !== 1200 || dimensions.height !== 630) {
    failures.push('A capa do WhatsApp deve ter exatamente 1200 x 630 pixels.');
  }
  if (ogImage.length > 300000) {
    failures.push('A capa do WhatsApp deve ter no máximo 300 KB.');
  }
}

if (failures.length > 0) {
  console.error('Validação do PWA falhou:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('PWA validado com sucesso.');
