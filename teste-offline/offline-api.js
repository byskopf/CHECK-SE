export const BASE = 'https://script.google.com/macros/s/AKfycbx7ReYi1OoXTvO2e-FLXczg-Ube0WZcjJSWe8HGlWbQtUof1F-1dOUQ-kqrwZQPjb6D/exec';
export const FIELDS = ['module', 'description', 'observations', 'date', 'pg', 'reference'];
export class ApiError extends Error {
  constructor(message, kind = 'api') { super(message); this.kind = kind; }
}
export function editable(dados) {
  return Object.fromEntries(FIELDS.filter(key => Object.hasOwn(dados, key)).map(key => [key, String(dados[key] ?? '')]));
}
export function toWire(record) {
  const item = { idLocal: record.idLocal, dados: editable(record.dados) };
  // "done" fica fora do FIELDS de propósito: não é um campo do formulário de edição, é a ação
  // "concluir" (completeRecord, em db.js). Passa direto, sem entrar na whitelist de texto.
  if (record.dados?.done === true) item.dados.done = true;
  if (record.id) { item.id = record.id; item.versao = record.syncVersion; }
  return item;
}
export function validSession(session) {
  return Boolean(session?.token && session?.account && Date.parse(session.sessionExpiresAt) > Date.now());
}
export function tokenOf(session) {
  if (!validSession(session)) throw new ApiError('Sessão expirada. Entre novamente; seus dados offline continuam salvos.', 'auth');
  return session.token;
}
export async function request(api, params, post = false, fetcher = globalThis.fetch) {
  const url = new URL(BASE);
  url.searchParams.set('api', api);
  const options = { method: post ? 'POST' : 'GET', cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer' };
  if (post) {
    options.headers = { 'Content-Type': 'text/plain;charset=utf-8' };
    options.body = JSON.stringify(params);
  } else {
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  }
  const controller = new AbortController();
  options.signal = controller.signal;
  const timeout = setTimeout(() => controller.abort(), 45000);
  try {
    const response = await fetcher(url.href, options);
    if (!response.ok) throw new ApiError('Falha HTTP. Confira a conexão antes de tentar novamente.', 'transport');
    let data;
    try { data = await response.json(); } catch { throw new ApiError('O servidor não retornou JSON válido.', 'protocol'); }
    if (data?.ok !== true) {
      const message = typeof data?.error === 'string' ? data.error : 'Resposta sem confirmação do servidor.';
      const auth = /sess[aã]o|session|token|access.?code|autoriz|autentic|expir/i.test(message);
      throw new ApiError(message, auth ? 'auth' : 'api');
    }
    return data;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError('Conexão interrompida ou indisponível. Os dados locais foram preservados.', 'transport');
  } finally { clearTimeout(timeout); }
}
export async function login(username, password) {
  const data = await request('apiLoginBase', { username, password });
  const session = { token: data.token, sessionExpiresAt: data.sessionExpiresAt, account: String(data.base?.id || data.base?.username || '') };
  if (!validSession(session)) throw new ApiError('Login sem identificação ou validade de sessão.', 'protocol');
  return session;
}
export async function listWorks(session) {
  const data = await request('listarObrasOffline', { accessCode: tokenOf(session) });
  if (!Array.isArray(data.obras) || data.obras.some(w => typeof w.chave !== 'string' || !w.chave)) throw new ApiError('Lista de obras inválida.', 'protocol');
  return data.obras;
}
export async function download(session, substationKey) {
  const data = await request('getDadosOffline', { accessCode: tokenOf(session), substationKey });
  if (data.substationKey !== substationKey || !data.obra || !Array.isArray(data.registros) ||
      data.registros.some(r => !r.id || !Number.isInteger(r.versao) || r.versao < 0 || !r.dados || typeof r.dados !== 'object') ||
      new Set(data.registros.map(r => r.id)).size !== data.registros.length) throw new ApiError('Download inválido. Dados anteriores preservados.', 'protocol');
  return data;
}
export function sendBatch(session, substationKey, records) {
  return request('sincronizarRegistrosOffline', { accessCode: tokenOf(session), substationKey, registros: records.map(toWire) }, true);
}
export async function blobToBase64(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(binary);
}
export async function uploadPhoto(session, substationKey, issueId, versao, blob) {
  const base64 = await blobToBase64(blob);
  return request('enviarFotoOffline', { accessCode: tokenOf(session), substationKey, issueId, versao, base64 }, true);
}
export function removePhoto(session, substationKey, issueId, versao) {
  return request('removerFotoOffline', { accessCode: tokenOf(session), substationKey, issueId, versao }, true);
}
export async function fetchPhoto(session, substationKey, issueId) {
  const data = await request('getFotoOffline', { accessCode: tokenOf(session), substationKey, issueId });
  if (typeof data.base64 !== 'string' || !data.base64) throw new ApiError('Foto inválida recebida do servidor.', 'protocol');
  return `data:${data.contentType || 'image/jpeg'};base64,${data.base64}`;
}
