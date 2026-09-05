import { lock, stateOf, changeState } from './db.js';
import { sendBatch, tokenOf, uploadPhoto, removePhoto } from './offline-api.js';
export const BATCH_SIZE = 25;
export function applyResults(state, sent, response) {
  const results = Array.isArray(response?.resultados) ? response.resultados : [];
  for (const snapshot of sent) {
    const record = state.records.find(r => r.idLocal === snapshot.idLocal);
    const queue = state.queue.find(q => q.idLocal === snapshot.idLocal);
    if (!record || !queue) continue;
    const matches = results.filter(r => r?.idLocal === snapshot.idLocal);
    const result = matches.length === 1 ? matches[0] : null;
    const validVersion = Number.isInteger(result?.versao) && result.versao >= 0;
    const sameId = !snapshot.id || result?.idServidor === snapshot.id;
    if (result?.sucesso === true && result.conflito === false && typeof result.idServidor === 'string' && result.idServidor && sameId && validVersion && (!snapshot.id || result.versao > snapshot.syncVersion)) {
      record.id = result.idServidor;
      record.syncVersion = result.versao;
      record.atualizadoEm = result.atualizadoEm;
      record.status = 'sincronizado';
      delete record.error;
      delete record.server;
      state.queue = state.queue.filter(q => q.idLocal !== record.idLocal);
    } else if (result?.conflito === true && result.sucesso === false && sameId) {
      record.status = 'conflito';
      record.server = structuredClone(result);
      record.error = result.motivo || 'A versão do servidor mudou. Compare antes de decidir.';
      queue.phase = 'conflict';
    } else {
      record.status = 'erro';
      record.error = 'Envio sem confirmação válida. Confira no servidor antes de autorizar novo envio.';
      queue.phase = 'uncertain';
    }
  }
  return state;
}
export async function synchronize(session, work, sender = sendBatch) {
  tokenOf(session);
  return lock(session.account, async () => {
    // A closed tab may have sent a POST whose response never reached IndexedDB.
    await changeState(session.account, state => {
      for (const queued of state.queue.filter(q => q.phase === 'sending')) {
        queued.phase = 'uncertain';
        const record = state.records.find(r => r.idLocal === queued.idLocal);
        record.status = 'erro';
        record.error = 'Envio interrompido. Confira o servidor antes de reenviar.';
      }
      return state;
    });
    while (true) {
      tokenOf(session);
      const state = await stateOf(session.account);
      const ids = state.queue.filter(q => q.work === work && q.phase === 'pending').slice(0, BATCH_SIZE).map(q => q.idLocal);
      const sent = state.records.filter(r => ids.includes(r.idLocal));
      if (!sent.length) return;
      await changeState(session.account, current => {
        current.queue.filter(q => ids.includes(q.idLocal)).forEach(q => { q.phase = 'sending'; });
        return current;
      });
      let response;
      try { response = await sender(session, work, sent); }
      catch (error) {
        await changeState(session.account, current => {
          for (const queued of current.queue.filter(q => ids.includes(q.idLocal))) {
            const record = current.records.find(r => r.idLocal === queued.idLocal);
            // Even HTTP errors may occur after a server write. Never retry blindly.
            queued.phase = error.kind === 'auth' ? 'pending' : 'uncertain';
            record.status = error.kind === 'auth' ? 'pendente' : 'erro';
            record.error = error.message;
          }
          return current;
        });
        throw error;
      }
      await changeState(session.account, current => applyResults(current, sent, response));
    }
  });
}
// Foto so' pode subir DEPOIS que a pendencia tem id do servidor - por isso e' um passo a
// parte, rodado apos o texto (que e' quem cria o id de uma pendencia nova). Um registro por
// vez: cada envio de foto ja e' uma chamada HTTP cheia (a foto e' grande), sem sentido em lote.
export async function synchronizePhotos(session, work, uploader = uploadPhoto, remover = removePhoto) {
  tokenOf(session);
  return lock(session.account, async () => {
    while (true) {
      tokenOf(session);
      const state = await stateOf(session.account);
      const record = state.records.find(r => r.work === work && r.photo && r.id && r.status === 'sincronizado');
      if (!record) return;
      const { action, blob } = record.photo;
      let result;
      try {
        result = action === 'remove'
          ? await remover(session, work, record.id, record.syncVersion)
          : await uploader(session, work, record.id, record.syncVersion, blob);
      } catch (error) {
        await changeState(session.account, current => {
          const r = current.records.find(x => x.idLocal === record.idLocal);
          if (r) r.photoError = error.message;
          return current;
        });
        throw error;
      }
      await changeState(session.account, current => {
        const r = current.records.find(x => x.idLocal === record.idLocal);
        if (!r) return current;
        if (result.sucesso === true && result.conflito === false) {
          r.dados = { ...r.dados, photoFileId: result.dados?.photoFileId ?? '' };
          r.syncVersion = result.versao;
          r.atualizadoEm = result.atualizadoEm;
          delete r.photo;
          delete r.photoError;
          if (r.status === 'sincronizado') current.queue = current.queue.filter(q => q.idLocal !== r.idLocal);
        } else if (result.conflito === true) {
          r.status = 'conflito';
          r.server = structuredClone(result);
          r.error = result.motivo || 'A versão do servidor mudou. Compare antes de decidir.';
          const queued = current.queue.find(q => q.idLocal === r.idLocal);
          if (queued) queued.phase = 'conflict'; else current.queue.push({ idLocal: r.idLocal, work, phase: 'conflict' });
        } else {
          // sucesso:false sem conflito (ex.: pendencia concluida entre o clique e o envio).
          r.photoError = result.motivo || 'Não foi possível salvar a foto.';
          delete r.photo;
        }
        return current;
      });
    }
  });
}
export function resolveRecord(account, idLocal, choice) {
  return lock(account, () => changeState(account, state => {
    const record = state.records.find(r => r.idLocal === idLocal);
    const queued = state.queue.find(q => q.idLocal === idLocal);
    if (!record || !queued) throw new Error('Registro sem alteração pendente.');
    if (choice === 'retry' && record.status === 'erro') {
      queued.phase = 'pending'; record.status = 'pendente'; delete record.error;
      return state;
    }
    const server = record.server;
    if (record.status !== 'conflito' || !record.id || server?.idServidor !== record.id || !server?.dados || typeof server.dados !== 'object' || Array.isArray(server.dados) || !Number.isInteger(server.versao) || server.versao < record.syncVersion) throw new Error('Sem versão válida para resolver. Preserve a cópia local e confira o servidor.');
    if (choice === 'server') {
      record.dados = structuredClone(server.dados);
      record.status = 'sincronizado';
      state.queue = state.queue.filter(q => q.idLocal !== idLocal);
    } else if (choice === 'local') {
      record.status = 'pendente'; queued.phase = 'pending';
    } else throw new Error('Decisão inválida.');
    record.syncVersion = server.versao;
    record.atualizadoEm = server.atualizadoEm;
    delete record.server; delete record.error;
    return state;
  }));
}
