import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const root = resolve('.');
const server = createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    const file = resolve(root, '.' + pathname + (pathname.endsWith('/') ? 'index.html' : ''));
    if (!file.startsWith(root + sep)) { res.writeHead(403).end(); return; }
    const body = await readFile(file);
    res.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png' })[extname(file)] || 'application/octet-stream');
    res.end(body);
  } catch { res.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_CHANNEL ? { channel: process.env.BROWSER_CHANNEL } : {}) });
let count = 0;
async function test(name, fn) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    await page.goto(origin + '/teste-offline/');
    await page.waitForFunction(() => document.getElementById('message').textContent === 'Armazenamento local pronto.');
    await fn(page, context);
    assert.deepEqual(errors, []); count++; console.log('PASS ' + name);
  } finally { await context.close(); }
}
try {
  await test('Login, download, edição, reload offline, sincronização e isolamento do worker', async (page, context) => {
    const payloads = [];
    await context.route('https://script.google.com/**', async route => {
      const req = route.request(), api = new URL(req.url()).searchParams.get('api');
      let data;
      if (api === 'apiLoginBase') data = { ok: true, token: 'SES-test', base: { id: 'a' }, sessionExpiresAt: new Date(Date.now() + 3600000).toISOString() };
      if (api === 'listarObrasOffline') data = { ok: true, obras: [{ chave: 'obra-a', nome: 'Obra de teste' }] };
      if (api === 'getDadosOffline') data = { ok: true, substationKey: 'obra-a', obra: { meta: { se: 'SE Teste' }, modules: ['Módulo 1'] }, registros: [], geradoEm: '2026-09-05T12:00:00Z' };
      if (api === 'sincronizarRegistrosOffline') {
        assert.equal(req.method(), 'POST'); assert.equal(req.headers()['content-type'], 'text/plain;charset=utf-8');
        const body = req.postDataJSON(); payloads.push(body);
        data = { ok: true, resultados: body.registros.map(r => ({ idLocal: r.idLocal, idServidor: 'OFF-1', sucesso: true, conflito: false, versao: 1 })) };
      }
      await route.fulfill({ json: data });
    });
    await page.locator('[name=username]').fill('test'); await page.locator('[name=password]').fill('test');
    await page.getByRole('button', { name: 'Entrar no teste' }).click();
    await page.waitForFunction(() => document.getElementById('session-status').textContent.includes('Conta: a'));
    await page.locator('#list').click(); await page.waitForFunction(() => document.querySelectorAll('#works option').length === 2);
    await page.locator('#works').selectOption('obra-a'); await page.locator('#download').click();
    await page.waitForFunction(() => !document.getElementById('new').disabled);
    await page.locator('#new').click(); await page.locator('[name=module]').fill('Módulo 1'); await page.locator('[name=description]').fill('Pendência em campo');
    await page.getByRole('button', { name: 'Salvar no aparelho' }).click();
    await page.waitForFunction(() => document.querySelector('#counts').textContent.includes('1 pendente'));
    await page.waitForFunction(() => navigator.serviceWorker.controller?.scriptURL.endsWith('/teste-offline/sw.js'));
    await context.setOffline(true); await page.reload();
    await page.waitForFunction(() => document.querySelector('#works option[value="obra-a"]'));
    await page.locator('#works').selectOption('obra-a'); await page.getByRole('heading', { name: 'Pendência em campo' }).waitFor();
    await context.setOffline(false); await page.locator('#sync').click();
    await page.waitForFunction(() => document.querySelector('#counts').textContent.includes('1 sincronizado'));
    assert.equal(payloads.length, 1); assert.equal(payloads[0].registros[0].id, undefined); assert.equal(payloads[0].registros[0].versao, undefined);
    const scopes = await page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).map(r => new URL(r.scope).pathname));
    assert.deepEqual(scopes, ['/teste-offline/']);
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    if (process.env.OFFLINE_SCREENSHOT) await page.screenshot({ path: process.env.OFFLINE_SCREENSHOT, fullPage: true });
  });
  await test('HTTP 200 com ok:false, URLs codificadas e whitelist do POST', async page => {
    const result = await page.evaluate(async () => {
      const api = await import('./offline-api.js'); let captured;
      await api.request('apiLoginBase', { username: 'a&b', password: '?# ç' }, false, async (url, options) => { captured = { url, options }; return { ok: true, json: async () => ({ ok: true }) }; });
      let error;
      try { await api.request('x', {}, false, async () => ({ ok: true, json: async () => ({ ok: false, error: 'Sessão expirada' }) })); } catch (e) { error = e.kind; }
      return { user: new URL(captured.url).searchParams.get('username'), password: new URL(captured.url).searchParams.get('password'), cache: captured.options.cache, error, wire: api.toWire({ idLocal: 'local', id: 'ISS-1', syncVersion: 3, dados: { description: 'd', version: 99, done: true, seq: 1 } }) };
    });
    assert.equal(result.user, 'a&b'); assert.equal(result.password, '?# ç'); assert.equal(result.cache, 'no-store'); assert.equal(result.error, 'auth');
    assert.deepEqual(result.wire, { idLocal: 'local', id: 'ISS-1', versao: 3, dados: { description: 'd', done: true } });
  });
  await test('IndexedDB atômico, contas separadas, download preserva pendências e sessão expirada', async page => {
    const result = await page.evaluate(async () => {
      const db = await import('./db.js'), { synchronize } = await import('./sync.js');
      await db.changeState('a', state => db.mergeDownload(state, 'w', { obra: { meta: {} }, registros: [{ id: 'ISS-1', versao: 3, dados: { description: 'original' } }] }));
      const old = (await db.stateOf('a')).records[0];
      await db.saveRecord('a', 'w', old.idLocal, { description: 'local' }, old);
      await db.changeState('a', state => db.mergeDownload(state, 'w', { obra: { meta: {} }, registros: [{ id: 'ISS-1', versao: 4, dados: { description: 'servidor' } }] }));
      let stale, expired, calls = 0;
      try { await db.saveRecord('a', 'w', old.idLocal, { description: 'obsoleto' }, old); } catch { stale = true; }
      try { await synchronize({ account: 'a', token: 'x', sessionExpiresAt: '2000-01-01' }, 'w', () => { calls++; }); } catch (e) { expired = e.kind; }
      try { await db.changeState('a', state => { state.records = []; throw new Error('rollback'); }); } catch {}
      return { state: await db.stateOf('a'), other: await db.stateOf('b'), stale, expired, calls };
    });
    assert.equal(result.state.records[0].dados.description, 'local'); assert.equal(result.state.records[0].syncVersion, 3);
    assert.equal(result.state.queue.length, 1); assert.equal(result.other.records.length, 0); assert.equal(result.stale, true); assert.equal(result.expired, 'auth'); assert.equal(result.calls, 0);
  });
  await test('Lotes de 25, sucesso parcial, conflito, exclusão e respostas desconhecidas', async page => {
    const result = await page.evaluate(async () => {
      const db = await import('./db.js'), sync = await import('./sync.js');
      await db.changeState('a', s => { s.works.push({ chave: 'w', downloaded: true }); return s; });
      for (let i = 0; i < 27; i++) await db.saveRecord('a', 'w', null, { description: String(i) });
      const batches = [];
      await sync.synchronize({ account: 'a', token: 'x', sessionExpiresAt: '2099-01-01' }, 'w', async (_, __, records) => {
        batches.push(records.length);
        return { ok: true, resultados: records.map(r => ({ idLocal: r.idLocal, idServidor: 'OFF-' + r.idLocal, sucesso: true, conflito: false, versao: 1 })) };
      });
      const sent = [{ idLocal: '1', id: 'ISS-1', syncVersion: 3 }, { idLocal: '2', id: 'ISS-2', syncVersion: 3 }, { idLocal: '3' }];
      const state = { records: sent.map(r => ({ ...r, dados: { description: 'local' } })), queue: sent.map(r => ({ idLocal: r.idLocal })) };
      sync.applyResults(state, sent, { resultados: [{ idLocal: '1', idServidor: 'ISS-1', sucesso: false, conflito: true, versao: 5, dados: { description: 'remoto' } }, { idLocal: '2', idServidor: 'ISS-2', sucesso: false, conflito: true, motivo: 'Excluída' }] });
      await db.changeState('conflict', () => state);
      await sync.resolveRecord('conflict', '1', 'local');
      const local = await db.stateOf('conflict');
      const initial = structuredClone(state);
      await db.changeState('server', () => initial);
      await sync.resolveRecord('server', '1', 'server');
      return { batches, completed: await db.stateOf('a'), state, local, server: await db.stateOf('server') };
    });
    assert.deepEqual(result.batches, [25, 2]); assert.equal(result.completed.queue.length, 0);
    assert.deepEqual(result.state.records.map(r => r.status), ['conflito', 'conflito', 'erro']);
    assert.equal(result.local.records[0].dados.description, 'local'); assert.equal(result.local.records[0].syncVersion, 5); assert.equal(result.local.records[0].status, 'pendente');
    assert.equal(result.server.records[0].dados.description, 'remoto'); assert.equal(result.server.queue.length, 2);
  });
  await test('Resposta perdida e fechamento da aba não provocam reenvio automático', async page => {
    const result = await page.evaluate(async () => {
      const db = await import('./db.js'), sync = await import('./sync.js');
      await db.changeState('a', s => { s.works.push({ chave: 'w', downloaded: true }); return s; });
      await db.saveRecord('a', 'w', null, { description: 'novo' });
      const session = { account: 'a', token: 'x', sessionExpiresAt: '2099-01-01' };
      let calls = 0;
      const sender = async () => { calls++; throw new Error('network'); };
      try { await sync.synchronize(session, 'w', sender); } catch {}
      await sync.synchronize(session, 'w', sender);
      const uncertain = await db.stateOf('a');
      await db.changeState('a', s => { s.queue[0].phase = 'sending'; return s; });
      await sync.synchronize(session, 'w', sender);
      return { calls, uncertain, recovered: await db.stateOf('a') };
    });
    assert.equal(result.calls, 1); assert.equal(result.uncertain.queue[0].phase, 'uncertain'); assert.equal(result.recovered.records[0].status, 'erro');
  });
  await test('Confirmações duplicadas ou de outro ID não apagam a fila; sucesso parcial é conciliado', async page => {
    const result = await page.evaluate(async () => {
      const { applyResults } = await import('./sync.js');
      const sent = ['1', '2', '3'].map(id => ({ idLocal: id, id: 'ISS-' + id, syncVersion: 3, dados: { description: id } }));
      const state = { records: structuredClone(sent), queue: sent.map(r => ({ idLocal: r.idLocal })) };
      const success = (id, server) => ({ idLocal: id, idServidor: server, sucesso: true, conflito: false, versao: 4 });
      return applyResults(state, sent, { resultados: [success('1', 'ISS-1'), success('2', 'ISS-2'), success('2', 'ISS-2'), success('3', 'ISS-OTHER')] });
    });
    assert.deepEqual(result.records.map(r => r.status), ['sincronizado', 'erro', 'erro']);
    assert.deepEqual(result.queue.map(q => q.idLocal), ['2', '3']);
  });
  await test('Bloqueio entre abas impede dois POSTs simultâneos', async (page, context) => {
    await page.evaluate(async () => {
      const db = await import('./db.js');
      await db.changeState('a', s => { s.works.push({ chave: 'w', downloaded: true }); return s; });
      await db.saveRecord('a', 'w', null, { description: 'único' });
    });
    const second = await context.newPage(); await second.goto(origin + '/teste-offline/');
    const job = async page => page.evaluate(async () => {
      const { synchronize } = await import('./sync.js'); let calls = 0;
      await synchronize({ account: 'a', token: 'x', sessionExpiresAt: '2099-01-01' }, 'w', async (_, __, records) => {
        calls++; await new Promise(resolve => setTimeout(resolve, 100));
        return { resultados: records.map(r => ({ idLocal: r.idLocal, idServidor: 'OFF-1', sucesso: true, conflito: false, versao: 1 })) };
      }); return calls;
    });
    const calls = await Promise.all([job(page), job(second)]); assert.equal(calls[0] + calls[1], 1);
  });
  await test('Foto: exige id do servidor, cancela envio local sem chamar rede, sobe com sucesso e trata conflito', async page => {
    const result = await page.evaluate(async () => {
      const db = await import('./db.js'), sync = await import('./sync.js');
      await db.changeState('a', s => { s.works.push({ chave: 'w', downloaded: true }); return s; });
      await db.saveRecord('a', 'w', null, { description: 'sem id ainda' });
      const semId = (await db.stateOf('a')).records[0];
      let semIdFalhou;
      try { await db.setLocalPhoto('a', 'w', semId.idLocal, new Blob(['x'])); } catch { semIdFalhou = true; }
      await db.changeState('a', s => { s.records = []; s.queue = []; return s; });
      await db.changeState('a', s => db.mergeDownload(s, 'w', { obra: { meta: {} }, registros: [{ id: 'ISS-1', versao: 1, dados: { description: 'x', photoFileId: '' } }] }));
      const record = (await db.stateOf('a')).records[0];
      await db.setLocalPhoto('a', 'w', record.idLocal, new Blob(['x']));
      await db.removePhotoIntent('a', 'w', record.idLocal);
      const canceladoSemRede = (await db.stateOf('a')).records[0].photo;
      await db.setLocalPhoto('a', 'w', record.idLocal, new Blob(['x']));
      const session = { account: 'a', token: 'x', sessionExpiresAt: '2099-01-01' };
      let uploadCalls = 0;
      await sync.synchronizePhotos(session, 'w', async (_, __, issueId, versao) => {
        uploadCalls++;
        return { sucesso: true, conflito: false, id: issueId, versao: versao + 1, atualizadoEm: 'agora', dados: { description: 'x', photoFileId: 'FILE-1' } };
      });
      const afterUpload = (await db.stateOf('a')).records[0];
      await db.removePhotoIntent('a', 'w', record.idLocal);
      await sync.synchronizePhotos(session, 'w', async () => { throw new Error('não deveria subir'); }, async (_, __, issueId, versao) => ({ sucesso: false, conflito: true, idServidor: issueId, versao: versao + 1, atualizadoEm: 'depois', dados: { description: 'servidor-mudou', photoFileId: 'FILE-1' } }));
      const afterConflict = (await db.stateOf('a')).records[0];
      return { semIdFalhou, uploadCalls, canceladoSemRede, afterUpload: { photoFileId: afterUpload.dados.photoFileId, syncVersion: afterUpload.syncVersion, photo: afterUpload.photo }, afterConflict: { status: afterConflict.status, error: afterConflict.error, serverDados: afterConflict.server?.dados } };
    });
    assert.equal(result.semIdFalhou, true);
    assert.equal(result.canceladoSemRede, undefined);
    assert.equal(result.uploadCalls, 1);
    assert.equal(result.afterUpload.photoFileId, 'FILE-1'); assert.equal(result.afterUpload.syncVersion, 2); assert.equal(result.afterUpload.photo, undefined);
    assert.equal(result.afterConflict.status, 'conflito'); assert.deepEqual(result.afterConflict.serverDados, { description: 'servidor-mudou', photoFileId: 'FILE-1' });
  });
  await test('Conferir correção: aprova com sucesso e trata conflito - sempre chamada imediata (nunca fila)', async page => {
    const result = await page.evaluate(async () => {
      const db = await import('./db.js'), sync = await import('./sync.js');
      await db.changeState('a', s => db.mergeDownload(s, 'w', { obra: { meta: {} }, registros: [{ id: 'ISS-1', versao: 1, dados: { description: 'x', correctionStatus: 'awaiting_review', correctionReportedBy: 'Prestadora X', correctionNotes: 'Trocado o disjuntor' } }] }));
      const record = (await db.stateOf('a')).records[0];
      const session = { account: 'a', token: 'x', sessionExpiresAt: '2099-01-01' };
      const calls = [];
      await sync.reviewCorrectionRecord(session, 'w', record, true, 'Fulano', '', async (_, __, issueId, versao, aprovada, reviewedBy, notes) => {
        calls.push({ issueId, versao, aprovada, reviewedBy, notes });
        return { sucesso: true, conflito: false, id: issueId, versao: versao + 1, atualizadoEm: 'agora', dados: { description: 'x', correctionStatus: 'done', done: true } };
      });
      const afterApprove = (await db.stateOf('a')).records[0];
      await db.changeState('a', s => db.mergeDownload(s, 'w', { obra: { meta: {} }, registros: [{ id: 'ISS-2', versao: 1, dados: { description: 'y', correctionStatus: 'awaiting_review' } }] }));
      const record2 = (await db.stateOf('a')).records.find(r => r.id === 'ISS-2');
      let conflitoErro;
      try {
        await sync.reviewCorrectionRecord(session, 'w', record2, false, 'Fulano', 'Não ficou bom', async (_, __, issueId, versao) => ({ sucesso: false, conflito: true, idServidor: issueId, versao: versao + 1, dados: { description: 'servidor-mudou' } }));
      } catch (e) { conflitoErro = e.message; }
      const afterConflict = (await db.stateOf('a')).records.find(r => r.id === 'ISS-2');
      return { calls, afterApprove: { correctionStatus: afterApprove.dados.correctionStatus, syncVersion: afterApprove.syncVersion }, conflitoErro, afterConflictStatus: afterConflict.status };
    });
    assert.deepEqual(result.calls, [{ issueId: 'ISS-1', versao: 1, aprovada: true, reviewedBy: 'Fulano', notes: '' }]);
    assert.equal(result.afterApprove.correctionStatus, 'done'); assert.equal(result.afterApprove.syncVersion, 2);
    assert.ok(result.conflitoErro); assert.equal(result.afterConflictStatus, 'conflito');
  });
  await test('Gerar PDF da obra: agrupa por módulo, soma o resumo por situação e baixa o arquivo', async page => {
    let capturedPayload;
    await page.route('https://script.google.com/**', async route => {
      const req = route.request(), api = new URL(req.url()).searchParams.get('api');
      if (api === 'apiLoginBase') return route.fulfill({ json: { ok: true, token: 'SES-pdf', base: { id: 'p' }, sessionExpiresAt: new Date(Date.now() + 3600000).toISOString() } });
      if (api === 'listarObrasOffline') return route.fulfill({ json: { ok: true, obras: [{ chave: 'obra-pdf', nome: 'Obra PDF' }] } });
      if (api === 'getDadosOffline') return route.fulfill({ json: { ok: true, substationKey: 'obra-pdf', obra: { meta: { se: 'SE PDF', obra: 'Obra Teste' }, modules: ['Mod A'] }, registros: [
        { id: 'ISS-1', versao: 1, dados: { module: 'Mod A', description: 'Pendencia aberta', seq: 2, correctionStatus: 'open' } },
        { id: 'ISS-2', versao: 1, dados: { module: 'Mod A', description: 'Pendencia concluida', seq: 1, done: true, correctionStatus: 'done' } }
      ], geradoEm: '2026-09-05T12:00:00Z' } });
      if (api === 'gerarRelatorioPdfOffline') {
        assert.equal(req.method(), 'POST'); assert.equal(req.headers()['content-type'], 'text/plain;charset=utf-8');
        capturedPayload = req.postDataJSON().payload;
        return route.fulfill({ json: { ok: true, nome: 'CHECK-SE_teste.pdf', base64: btoa('PDF-FALSO') } });
      }
      await route.fulfill({ json: { ok: false, error: 'api não mockada: ' + api } });
    });
    await page.locator('[name=username]').fill('t'); await page.locator('[name=password]').fill('t');
    await page.getByRole('button', { name: 'Entrar no teste' }).click();
    await page.waitForFunction(() => document.getElementById('session-status').textContent.includes('Conta: p'));
    await page.locator('#list').click(); await page.waitForFunction(() => document.querySelectorAll('#works option').length === 2);
    await page.locator('#works').selectOption('obra-pdf'); await page.locator('#download').click();
    await page.waitForFunction(() => document.querySelector('#counts').textContent.includes('2 sincronizado'));
    const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#report').click()]);
    assert.equal(download.suggestedFilename(), 'CHECK-SE_teste.pdf');
    assert.deepEqual(capturedPayload.grupos.length, 1);
    assert.equal(capturedPayload.grupos[0].modulo, 'MOD A');
    assert.deepEqual(capturedPayload.grupos[0].itens.map(i => i.descricao), ['Pendencia concluida', 'Pendencia aberta']);
    assert.deepEqual(capturedPayload.resumo, { abertas: 1, comPrestadora: 0, emConferencia: 0, rejeitadas: 0, concluidas: 1, total: 2 });
    assert.equal(capturedPayload.semColunaCorrecao, true);
  });
  console.log(`${count} cenários passaram.`);
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
