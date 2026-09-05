import { FIELDS, login, listWorks, download, validSession, editable } from './offline-api.js';
import { read, mutate, stateOf, changeState, lock, saveRecord, completeRecord, mergeDownload } from './db.js';
import { synchronize, resolveRecord } from './sync.js';
const $ = id => document.getElementById(id);
let session, state, selected = '', editing = null, busy = false;
const message = text => { $('message').textContent = text; };
function node(tag, text, className) {
  const el = document.createElement(tag); el.textContent = text;
  if (className) el.className = className;
  return el;
}
function action(label, fn) {
  const button = node('button', label); button.type = 'button';
  button.addEventListener('click', () => run(fn)); return button;
}
function network() { $('network').textContent = navigator.onLine ? 'Com conexão' : 'Sem internet • dados locais'; }
async function refresh() {
  network();
  $('workspace').hidden = !session?.account;
  $('logout').hidden = !session?.account;
  $('session-status').textContent = session?.account ? `Conta: ${session.account} • ${validSession(session) ? 'Sessão ativa' : 'Entre novamente para baixar ou sincronizar. A consulta e edição offline continuam disponíveis.'}` : 'Entre para baixar suas obras.';
  if (!session?.account) return;
  state = await stateOf(session.account);
  $('works').replaceChildren(node('option', 'Selecione uma obra'));
  $('works').firstChild.value = '';
  for (const work of state.works) {
    const option = node('option', `${work.nome || work.chave}${work.downloaded ? ' • no aparelho' : ''}`);
    option.value = work.chave; $('works').append(option);
  }
  $('works').value = selected;
  const work = state.works.find(w => w.chave === selected);
  $('work-info').textContent = work?.downloaded ? `Dados baixados: ${work.geradoEm || 'data não informada'} • ${work.obra.meta?.se || ''}` : 'Escolha e baixe uma obra para trabalhar offline.';
  $('new').disabled = !work?.downloaded;
  $('modules').replaceChildren(...(work?.obra?.modules || []).map(name => { const option = node('option', name); option.value = name; return option; }));
  const records = state.records.filter(r => r.work === selected);
  $('counts').textContent = ['sincronizado', 'pendente', 'conflito', 'erro'].map(status => `${records.filter(r => r.status === status).length} ${status}`).join(' • ');
  $('records').replaceChildren();
  for (const record of records) {
    const card = document.createElement('article');
    card.append(node('span', record.status, 'badge ' + record.status), node('h3', record.dados.description || '(sem descrição)'), node('p', `${record.dados.module || ''} • ${record.dados.date || ''}`));
    if (record.dados.done) card.append(node('span', 'concluída', 'badge concluida'));
    if (record.dados.observations) card.append(node('p', record.dados.observations));
    const details = document.createElement('details'); details.append(node('summary', 'Ver dados locais'), node('pre', JSON.stringify(record.dados, null, 2))); card.append(details);
    if (record.error) card.append(node('p', record.error));
    if (['sincronizado', 'pendente'].includes(record.status) && !record.dados.done) {
      card.append(action('Editar', () => openEditor(record)));
      card.append(action('Concluir', async () => {
        if (confirm('Marcar esta pendência como concluída? A foto anexada (se houver) será apagada, assim como no app principal.')) await completeRecord(session.account, selected, record);
      }));
    }
    if (record.status === 'conflito') {
      card.append(node('h4', 'Versão do servidor'), node('pre', JSON.stringify(record.server?.dados || { motivo: record.server?.motivo }, null, 2)));
      if (record.server?.dados && Number.isInteger(record.server.versao)) {
        card.append(action('Usar versão do servidor', async () => {
          if (confirm('Descartar esta alteração local e usar a versão do servidor exibida? Exporte antes se precisar guardar as duas.')) await resolveRecord(session.account, record.idLocal, 'server');
        }), action('Manter minha edição para novo envio', async () => {
          if (confirm('Preparar sua edição usando a versão do servidor exibida? Ela será enviada na próxima sincronização, que ainda pode detectar novo conflito.')) await resolveRecord(session.account, record.idLocal, 'local');
        }));
      }
    }
    if (record.status === 'erro') card.append(action('Conferi o servidor: autorizar nova tentativa', async () => {
      if (confirm('O envio anterior pode ter sido gravado. Você conferiu o servidor e confirmou que reenviar não criará uma duplicata?')) await resolveRecord(session.account, record.idLocal, 'retry');
    }));
    $('records').append(card);
  }
}
async function run(fn) {
  if (busy) return;
  busy = true;
  document.querySelectorAll('button, select').forEach(el => { el.disabled = true; });
  try { await fn(); }
  catch (error) {
    if (error.kind === 'auth' && session) {
      session = { ...session, token: '', sessionExpiresAt: '' };
      await mutate('session', () => session).catch(() => {});
    }
    message(error.message || 'Não foi possível concluir.');
  } finally {
    busy = false;
    document.querySelectorAll('button, select').forEach(el => { el.disabled = false; });
    await refresh().catch(error => message(error.message));
  }
}
function openEditor(record = null) {
  editing = record ? structuredClone(record) : null;
  $('record-form').reset();
  for (const field of FIELDS) $('record-form').elements.namedItem(field).value = record?.dados[field] || '';
  if (!record) $('record-form').elements.namedItem('date').value = new Date().toLocaleDateString('sv-SE');
  $('editor-title').textContent = record ? 'Editar pendência' : 'Nova pendência';
  $('editor').hidden = false; $('editor').scrollIntoView({ behavior: 'smooth' });
}
async function syncSelected() {
  if (!selected) throw new Error('Selecione uma obra.');
  message('Sincronizando… mantenha esta aba aberta.');
  await synchronize(session, selected);
  message('Sincronização concluída. Confira os estados dos registros abaixo.');
}
$('login-form').addEventListener('submit', event => {
  event.preventDefault();
  const form = event.currentTarget;
  const username = form.elements.username.value.trim(), password = form.elements.password.value;
  form.elements.password.value = '';
  run(async () => {
    const next = await login(username, password);
    await mutate('session', () => next); session = next;
    selected = ''; editing = null; $('editor').hidden = true;
    message('Acesso confirmado. Atualize a lista de obras para baixar os dados.');
  });
});
$('logout').onclick = () => run(async () => {
  await mutate('session', () => null); session = null; state = null; selected = ''; editing = null;
  $('editor').hidden = true; $('records').replaceChildren();
  message('Sessão encerrada. Dados locais preservados para o próximo acesso à mesma conta.');
});
$('works').onchange = () => { selected = $('works').value; $('editor').hidden = true; editing = null; run(refresh); };
$('list').onclick = () => run(async () => {
  const works = await listWorks(session);
  await lock(session.account, () => changeState(session.account, current => {
    current.works = [...works.map(work => ({ ...current.works.find(w => w.chave === work.chave), ...work })), ...current.works.filter(w => w.downloaded && !works.some(next => next.chave === w.chave))];
    return current;
  })); message('Lista atualizada. Obras já baixadas foram preservadas.');
});
$('download').onclick = () => run(async () => {
  if (!selected) throw new Error('Selecione uma obra.');
  await lock(session.account, async () => {
    const data = await download(session, selected);
    await changeState(session.account, current => mergeDownload(current, selected, data));
  }); message('Obra salva no aparelho. Alterações pendentes preservadas.');
});
$('new').onclick = () => openEditor();
$('cancel').onclick = () => { $('editor').hidden = true; editing = null; };
$('record-form').onsubmit = event => {
  event.preventDefault();
  const dados = editable(Object.fromEntries(new FormData(event.currentTarget)));
  run(async () => {
    await saveRecord(session.account, selected, editing?.idLocal, dados, editing);
    $('editor').hidden = true; editing = null; message('Salvo no aparelho. Aguardando sincronização.');
  });
};
$('sync').onclick = () => run(syncSelected);
$('export').onclick = () => run(async () => {
  const current = await stateOf(session.account);
  const blob = new Blob([JSON.stringify({ ambiente: 'teste', exportadoEm: new Date().toISOString(), ...current }, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob), link = document.createElement('a');
  link.href = url; link.download = 'check-se-teste-copia-local.json'; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000); message('Cópia exportada sem senha ou token.');
});
window.addEventListener('online', () => { network(); if ($('auto').checked && selected && validSession(session)) run(syncSelected); });
window.addEventListener('offline', network);
window.addEventListener('focus', () => { if (!busy) run(refresh); });
async function start() {
  session = await read('session');
  if (session?.account) {
    // Recover interrupted sends without requiring a valid online session.
    await lock(session.account, () => changeState(session.account, current => {
      for (const q of current.queue.filter(q => q.phase === 'sending')) {
        q.phase = 'uncertain';
        const record = current.records.find(r => r.idLocal === q.idLocal);
        record.status = 'erro'; record.error = 'Envio interrompido. Confira no servidor antes de reenviar.';
      }
      return current;
    }));
  }
  await refresh(); message('Armazenamento local pronto.');
  if ('serviceWorker' in navigator) {
    try {
      const registration = await navigator.serviceWorker.register('./sw.js', { scope: './', updateViaCache: 'none' });
      if (registration.waiting && registration.active) {
        $('offline-ready').textContent = 'Interface offline disponível. Há uma atualização: feche as abas de teste e reabra para aplicá-la.';
        return;
      }
      const worker = registration.active || registration.installing || registration.waiting;
      if (worker && worker.state !== 'activated') await new Promise((resolve, reject) => {
        worker.addEventListener('statechange', () => {
          if (worker.state === 'activated') resolve();
          if (worker.state === 'redundant') reject(new Error('Falha ao preparar cache offline.'));
        });
      });
      $('offline-ready').textContent = 'Interface pronta para abrir sem internet. Baixe também os dados da obra.';
    } catch { $('offline-ready').textContent = 'A interface ainda não está pronta para abrir offline. Reabra com internet.'; }
  } else $('offline-ready').textContent = 'Este navegador não permite preparar a interface offline.';
}
start().catch(error => message(error.message));
