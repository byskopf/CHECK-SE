(function () {
  'use strict';

  var APP_URL = 'https://script.google.com/macros/s/AKfycbx7ReYi1OoXTvO2e-FLXczg-Ube0WZcjJSWe8HGlWbQtUof1F-1dOUQ-kqrwZQPjb6D/exec';
  var deferredInstallPrompt = null;

  var installButton = document.getElementById('installButton');
  var installButtonText = document.getElementById('installButtonText');
  var installHint = document.getElementById('installHint');
  var openButton = document.getElementById('openButton');
  var openButtonText = document.getElementById('openButtonText');
  var introText = document.getElementById('introText');
  var connectionBanner = document.getElementById('connectionBanner');
  var launchOverlay = document.getElementById('launchOverlay');
  var installDialog = document.getElementById('installDialog');
  var installInstructions = document.getElementById('installInstructions');

  var userAgent = navigator.userAgent || '';
  var isIOS = /iphone|ipad|ipod/i.test(userAgent);
  var isAndroid = /android/i.test(userAgent);
  var isStandalone = Boolean(
    (window.matchMedia && (
      window.matchMedia('(display-mode: standalone)').matches ||
      window.matchMedia('(display-mode: fullscreen)').matches ||
      window.matchMedia('(display-mode: minimal-ui)').matches
    )) || navigator.standalone === true
  );

  function updateConnectionState() {
    var offline = navigator.onLine === false;
    connectionBanner.hidden = !offline;

    if (offline) {
      installHint.textContent = 'Sem internet agora. Se o CHECK-SE já foi aberto neste aparelho, você ainda pode tentar acessá-lo.';
      openButtonText.textContent = 'Tentar abrir o CHECK-SE';
    } else if (isStandalone) {
      installHint.textContent = 'Aplicativo instalado neste aparelho.';
      openButtonText.textContent = 'Abrir CHECK-SE';
    } else {
      installHint.textContent = 'A instalação cria o ícone do CHECK-SE na tela inicial.';
      openButtonText.textContent = 'Abrir no navegador';
    }
  }

  function showLaunchOverlay() {
    launchOverlay.hidden = false;
    window.requestAnimationFrame(function () {
      launchOverlay.classList.add('show');
    });
  }

  function openCheckSe(replaceHistory) {
    showLaunchOverlay();
    window.setTimeout(function () {
      if (replaceHistory) window.location.replace(APP_URL);
      else window.location.assign(APP_URL);
    }, 420);
  }

  function instructionMarkup() {
    if (isIOS) {
      return '<p>No Safari, siga estes passos:</p>' +
        '<ol class="install-steps">' +
        '<li>Toque no botão Compartilhar.</li>' +
        '<li>Escolha “Adicionar à Tela de Início”.</li>' +
        '<li>Toque em “Adicionar”.</li>' +
        '</ol>';
    }

    if (isAndroid) {
      return '<p>Se a instalação automática não aparecer:</p>' +
        '<ol class="install-steps">' +
        '<li>Abra o menu do navegador.</li>' +
        '<li>Escolha “Instalar app” ou “Adicionar à tela inicial”.</li>' +
        '<li>Confirme a instalação.</li>' +
        '</ol>';
    }

    return '<p>Para instalar neste computador:</p>' +
      '<ol class="install-steps">' +
      '<li>Procure o ícone de instalação na barra de endereço.</li>' +
      '<li>Escolha “Instalar CHECK-SE”.</li>' +
      '<li>Confirme a instalação.</li>' +
      '</ol>';
  }

  function showInstallInstructions() {
    installInstructions.innerHTML = instructionMarkup();
    if (typeof installDialog.showModal === 'function') installDialog.showModal();
    else installDialog.setAttribute('open', '');
  }

  window.addEventListener('beforeinstallprompt', function (event) {
    event.preventDefault();
    deferredInstallPrompt = event;
    installButtonText.textContent = 'Instalar aplicativo';
    installHint.textContent = 'Pronto para instalar com o ícone correto.';
  });

  installButton.addEventListener('click', async function () {
    if (!deferredInstallPrompt) {
      showInstallInstructions();
      return;
    }

    installButton.disabled = true;
    installButtonText.textContent = 'Abrindo instalação…';

    try {
      await deferredInstallPrompt.prompt();
      var choice = await deferredInstallPrompt.userChoice;
      deferredInstallPrompt = null;

      if (choice && choice.outcome === 'accepted') {
        installButtonText.textContent = 'Aplicativo instalado';
        installHint.textContent = 'Abra o CHECK-SE pelo novo ícone na tela inicial.';
      } else {
        installButtonText.textContent = 'Instalar aplicativo';
        installHint.textContent = 'A instalação foi cancelada. Você pode tentar novamente.';
      }
    } catch (error) {
      installButtonText.textContent = 'Como instalar';
      installHint.textContent = 'Use as instruções para instalar manualmente.';
      showInstallInstructions();
    } finally {
      installButton.disabled = false;
    }
  });

  window.addEventListener('appinstalled', function () {
    deferredInstallPrompt = null;
    installButtonText.textContent = 'Aplicativo instalado';
    installButton.disabled = true;
    installHint.textContent = 'Abra o CHECK-SE pelo novo ícone na tela inicial.';
  });

  openButton.href = APP_URL;
  openButton.addEventListener('click', function (event) {
    if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || event.button > 0) return;
    event.preventDefault();
    openCheckSe(false);
  });

  window.addEventListener('online', updateConnectionState);
  window.addEventListener('offline', updateConnectionState);
  updateConnectionState();

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('/check-se/sw.js', { scope: '/check-se/' }).catch(function () {
        // A página continua funcionando normalmente mesmo se o registro falhar.
      });
    });
  }

  var openFromShortcut = new URLSearchParams(window.location.search).get('abrir') === '1';

  if (isStandalone) {
    installButton.hidden = true;
    introText.textContent = navigator.onLine === false
      ? 'O acesso está sem conexão. Você pode tentar abrir os dados já disponíveis neste aparelho.'
      : 'Aplicativo instalado. Abrindo o CHECK-SE…';
    openButtonText.textContent = navigator.onLine === false ? 'Tentar abrir o CHECK-SE' : 'Abrir agora';

    if (navigator.onLine !== false) {
      showLaunchOverlay();
      window.setTimeout(function () { openCheckSe(true); }, 620);
    }
  } else if (openFromShortcut) {
    openCheckSe(true);
  } else if (isIOS) {
    installButtonText.textContent = 'Como instalar no iPhone';
  }
}());
