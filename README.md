# CHECK-SE

Portal de instalação (PWA) do CHECK-SE — abre o aplicativo de comissionamento inteligente de subestações elétricas hospedado no Google Apps Script.

[![Validar PWA](https://github.com/byskopf/CHECK-SE/actions/workflows/validate-pwa.yml/badge.svg)](https://github.com/byskopf/CHECK-SE/actions/workflows/validate-pwa.yml)
[![Monitorar disponibilidade](https://github.com/byskopf/CHECK-SE/actions/workflows/monitor.yml/badge.svg)](https://github.com/byskopf/CHECK-SE/actions/workflows/monitor.yml)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)

Resumo
-----

Este repositório contém apenas a **tela de lançamento** do CHECK-SE: uma página estática instalável como PWA (ícone, tela cheia, cache offline da própria tela via service worker) que redireciona para o aplicativo real, publicado como Web App do Google Apps Script. A lógica de negócio (pendências, obras, sincronização, prestadoras) vive no Apps Script, fora deste repositório — aqui só cuidamos do "portão de entrada" e da experiência de instalação/atualização do PWA.

Demo
----

Uma versão demo pode ser publicada via GitHub Pages: https://byskopf.github.io/CHECK-SE/

Como executar localmente
------------------------

Opções simples sem dependências:

- Abrir `index.html` no navegador (recurso mínimo)
- Servir com Python: `python3 -m http.server 8000` e abrir http://localhost:8000
- Servir com Node: `npx http-server . -p 8000`

Se você for adicionar build steps (bundlers), documente-os aqui.

Estrutura do repositório
------------------------

- index.html — ponto de entrada
- app.js — lógica principal (recomenda-se modularizar)
- styles.css — estilos
- sw.js — service worker (PWA/offline)
- manifest.json — configuração PWA
- scripts/ — scripts utilitários
- CHANGELOG.md — histórico de versões

Contribuindo
------------

Obrigado pelo interesse em contribuir! Sugestões:

1. Abra uma issue descrevendo a melhoria/bug.
2. Crie um branch com nome descritivo: `feat/nome-da-feature` ou `fix/descricao`.
3. Siga o padrão de commits (opcional): Conventional Commits.
4. Adicione testes quando aplicável.
5. Abra o Pull Request descrevendo as mudanças.

Se quiser, posso adicionar `CONTRIBUTING.md` e templates de issue/PR.

Checklist de qualidade sugerida
-------------------------------

- [x] Adicionar LICENSE (MIT)
- [x] Adicionar README.md (feito)
- [x] Adicionar .gitignore
- [x] Configurar CI (validação de PWA + monitoramento de disponibilidade)
- [ ] Modularizar `app.js` e adicionar bundler para produção
- [ ] Otimizar imagens (WebP, srcset)
- [ ] Rodar testes de acessibilidade (axe / Lighthouse)

Licença
-------

Este repositório é distribuído sob a licença MIT — veja [`LICENSE`](./LICENSE).

Contato
-------

Crie issues no repositório ou entre em contato pelo perfil do GitHub.


