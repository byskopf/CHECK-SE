# CHECK-SE: teste offline

Implementação independente em `teste-offline/`, na branch `teste/pwa-offline`.
O portal, o manifest, o `start_url` e o service worker de produção permanecem inalterados.
Nenhum código do Apps Script é incluído ou publicado por esta implementação.

## Executar

Sirva a raiz do repositório por HTTP em localhost ou por HTTPS e abra `/teste-offline/`.
Por exemplo, com Python instalado: `python -m http.server 8080 --bind 127.0.0.1`,
depois abra `http://localhost:8080/teste-offline/`. Não use `file://`.

A branch de teste **não muda o GitHub Pages atual**. Não há publicação automática
desta branch. A rota só ficará disponível no Pages se estes arquivos forem futuramente
integrados à branch publicada. Não troque a origem do Pages para esta branch.

1. Entre com sua conta normal do CHECK-SE (agora aponta para a implantação de produção).
2. Atualize a lista, escolha uma obra e clique em **Baixar / atualizar obra**.
3. Aguarde a confirmação de que a interface está pronta para abrir offline.
4. Desconecte a internet, recarregue a página, selecione a obra e crie/edite pendências.
5. Reconecte e clique em **Sincronizar pendentes**. A sincronização ao voltar a internet
   é opcional, vale para a obra selecionada e somente enquanto a página estiver aberta.
6. Em conflito, compare as duas versões e escolha explicitamente qual usar.

## Arquivos

- `db.js`: IndexedDB exclusivo `check-se-offline-test-v1`, snapshots por conta contendo
  obras, registros e fila. Registro e fila são gravados na mesma transação.
- `offline-api.js`: URL fixa de teste, GETs, POST `text/plain;charset=utf-8`, validação
  de `ok`, conversão `syncVersion` → `versao` e whitelist dos campos editáveis.
- `sync.js`: lotes de até 25, conciliação por `idLocal`, conflitos e proteção contra
  reenvio após resultado incerto. Web Locks serializa operações da mesma conta entre abas.
- `app.js` e `index.html`: consulta, criação, edição, comparação, exportação e estados.
- `sw.js`: interface completa em cache exclusivo, somente no escopo `teste-offline/`.
  Não intercepta o domínio do Apps Script nem apaga caches da produção.

## Contrato implementado

Base fixa (produção, desde 2026-09-05):
`https://script.google.com/macros/s/AKfycbx7ReYi1OoXTvO2e-FLXczg-Ube0WZcjJSWe8HGlWbQtUof1F-1dOUQ-kqrwZQPjb6D/exec`

- GET `apiLoginBase`: `username`, `password`. Guarda token, validade e identificação
  da conta retornada por `base.id` (fallback `base.username`). Nunca persiste a senha.
- GET `listarObrasOffline`: `accessCode`.
- GET `getDadosOffline`: `accessCode`, `substationKey`.
- POST `sincronizarRegistrosOffline`: body `{accessCode, substationKey, registros}`.
  Novo registro omite `id`/`versao`; existente envia ambos. Todos enviam `idLocal` único.
- Envelope `{ok:true,resultados:[...]}`; sucesso individual exige `sucesso:true`,
  `conflito:false`, `idServidor` e `versao` válidos. Nunca usa apenas HTTP 200 ou a posição no lote.
- Conflito retém local e servidor separadamente. Exclusão no servidor fica como conflito
  para conferência, sem recriar automaticamente a pendência.
- Só edita/envia `module`, `description`, `observations`, `date`, `pg`, `reference`.
  Outros dados baixados permanecem para consulta; `version` (visita técnica), `seq`
  e `correctionStatus` não são alterados nem enviados por aqui.
- **Concluir pendência** (botão "Concluir"): liga `done` uma única vez (nunca desliga por
  este laboratório). O servidor apaga a foto anexada à pendência, se houver — mesma regra
  do app principal ("a foto só serve enquanto a pendência está viva").
- **Foto na pendência** (anexar, trocar, remover): só disponível depois que a pendência já
  tem id do servidor (uma pendência recém-criada offline ganha foto só depois do primeiro
  envio bem-sucedido). Comprimida no aparelho (lado maior 1024px, JPEG 60%, igual ao app
  principal) e enviada em POST próprio (`enviarFotoOffline`/`removerFotoOffline`), fora do
  lote de texto — a foto é grande demais para ir junto. Usa o mesmo controle de versão
  otimista: se a pendência mudou no meio-tempo, vira conflito em vez de sobrescrever. Some
  do Drive ao concluir a pendência, mesma regra do app principal.
- **Conferir correção** (Aprovar/Rejeitar): só aparece quando a pendência está "em
  conferência" (a prestadora já reportou o que fez). Chamada imediata — precisa de conexão
  na hora do clique, não entra na fila offline. Aprovar conclui a pendência (apaga fotos,
  mesma regra); rejeitar exige o motivo e devolve para a prestadora. Enviar o lote para a
  prestadora (gerar o link de WhatsApp) continua só pelo app principal.

## Preservação e limites

- Token expirado exige novo login para rede; dados locais e fila permanecem consultáveis/editáveis.
- Sair retira a sessão, preserva dados e oculta a conta. O próximo login na mesma conta os recupera.
- Downloads não substituem registros pendentes, em erro ou em conflito.
- Timeout, resposta incompleta, erro geral ou fechamento durante POST deixam envio em erro
  para conferência. Não há garantia documentada de idempotência no servidor: **não há retry cego**.
  Depois de conferir o servidor, o usuário pode autorizar uma nova tentativa por registro.
- A escolha “manter minha edição” apenas atualiza a versão-base e devolve à fila; não força sobrescrita.
- Exportação JSON inclui obras, registros, fila e versões conflitantes, sem senha/token.
  É uma cópia para conferência; importação/restauração não faz parte desta fase.
- Dados pertencem a este navegador/perfil. Limpar os dados do site ou usar navegação privada
  pode removê-los. Contas são separadas logicamente, sem criptografia local adicional.
- Requer IndexedDB, Service Worker e Web Locks (Chrome/Edge atuais). Não inclui exclusão
  offline, envio do lote à prestadora, relatórios ou sincronização com a página fechada.
  Concluir pendência, foto e conferir correção já funcionam (ver "Contrato implementado").
- Em futura atualização, incremente o nome do cache do worker. O novo worker aguarda
  fechamento das abas antigas antes de assumir, evitando misturar versões durante trabalho.

## Validação

```sh
npm ci
npx playwright install chromium
npm run test:offline
node scripts/validate-pwa.mjs
node --check app.js
node --check sw.js
git diff --check
```

Os testes usam um navegador real, IndexedDB e Service Worker reais, com respostas de API
simuladas pelo contrato. Cobrem login, recarga offline, criação, lote, mapeamento de versão,
expiração, contas separadas, rollback, conflitos, falhas e concorrência entre abas.
É possível usar Chrome instalado com `BROWSER_CHANNEL=chrome`.

Antes de liberar para produção, validar com conta de teste: login real, GETs, CORS/redirects
do POST, criação de um registro, edição de um existente e conflito real entre dois clientes.
Essas verificações autenticadas não foram realizadas nesta entrega.
