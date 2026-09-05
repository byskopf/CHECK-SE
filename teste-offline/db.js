const DB_NAME = 'check-se-offline-test-v1';
let database;
export function openDB() {
  if (!database) database = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore('state');
    request.onsuccess = () => { request.result.onversionchange = () => request.result.close(); resolve(request.result); };
    request.onerror = () => { database = null; reject(request.error); };
    request.onblocked = () => { database = null; reject(new Error('Feche outras abas de teste e abra novamente.')); };
  });
  return database;
}
const empty = () => ({ works: [], records: [], queue: [] });
// One account snapshot per transaction: record + outbox changes commit atomically.
export async function read(key) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('state', 'readonly');
    const req = tx.objectStore('state').get(key);
    tx.oncomplete = () => resolve(req.result);
    tx.onabort = () => reject(tx.error);
    tx.onerror = () => reject(tx.error);
  });
}
export async function mutate(key, change) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('state', 'readwrite');
    const store = tx.objectStore('state');
    const req = store.get(key);
    let value, failure;
    req.onsuccess = () => {
      try { value = change(req.result); store.put(value, key); }
      catch (error) { failure = error; tx.abort(); }
    };
    tx.oncomplete = () => resolve(value);
    tx.onabort = () => reject(failure || tx.error || new Error('Não foi possível salvar no aparelho.'));
    tx.onerror = () => reject(tx.error);
  });
}
export const accountKey = account => 'account:' + account;
export const stateOf = async account => (await read(accountKey(account))) || empty();
export const changeState = (account, fn) => mutate(accountKey(account), state => fn(state || empty()));
export function lock(account, fn) {
  if (!globalThis.navigator?.locks) throw new Error('Este navegador não oferece bloqueio seguro entre abas. Use Chrome ou Edge atualizado.');
  return navigator.locks.request('check-se-offline-test:' + account, fn);
}
export async function saveRecord(account, work, idLocal, dados, expected = null) {
  return lock(account, () => changeState(account, state => {
    if (!state.works.some(w => w.chave === work && w.downloaded)) throw new Error('Baixe a obra antes de editar.');
    let record = idLocal && state.records.find(r => r.idLocal === idLocal && r.work === work);
    if (idLocal && !record) throw new Error('Registro não encontrado.');
    if (record && expected && (JSON.stringify(record.dados) !== JSON.stringify(expected.dados) || record.syncVersion !== expected.syncVersion)) throw new Error('O registro mudou em outra aba. Abra a edição novamente antes de salvar.');
    if (record && ['conflito', 'erro'].includes(record.status)) throw new Error('Resolva o conflito ou confira o envio antes de editar.');
    if (!record) {
      record = { idLocal: crypto.randomUUID(), work, dados: {}, syncVersion: null };
      state.records.push(record);
    }
    record.dados = { ...record.dados, ...dados };
    record.status = 'pendente';
    record.updatedLocal = new Date().toISOString();
    const queued = state.queue.find(q => q.idLocal === record.idLocal);
    if (!queued) state.queue.push({ idLocal: record.idLocal, work, phase: 'pending' });
    return state;
  }));
}
export function mergeDownload(state, work, data) {
  const prior = state.works.find(w => w.chave === work) || { chave: work, nome: data.obra.meta?.obra || work };
  state.works = state.works.filter(w => w.chave !== work);
  state.works.push({ ...prior, downloaded: true, obra: data.obra, geradoEm: data.geradoEm });
  const incoming = new Map(data.registros.map(r => [r.id, r]));
  state.records = state.records.filter(r => r.work !== work || r.status !== 'sincronizado' || incoming.has(r.id));
  for (const server of data.registros) {
    const local = state.records.find(r => r.work === work && r.id === server.id);
    if (local && local.status !== 'sincronizado') continue;
    const record = { idLocal: local?.idLocal || crypto.randomUUID(), work, id: server.id, syncVersion: server.versao, dados: server.dados, atualizadoEm: server.atualizadoEm, status: 'sincronizado' };
    if (local) Object.assign(local, record); else state.records.push(record);
  }
  return state;
}
