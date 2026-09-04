(function () {
  'use strict';

  var PWA_VERSION = '1.1.0';
  var APP_URL = 'https://script.google.com/macros/s/AKfycbx7ReYi1OoXTvO2e-FLXczg-Ube0WZcjJSWe8HGlWbQtUof1F-1dOUQ-kqrwZQPjb6D/exec';
  var deferredInstallPrompt = null;
  var serviceWorkerRegistration = null;
  var reloadAfterUpdate = false;
  var launchSlowTimer = null;

  var installButton = document.getElementById('installButton');
  var installButtonText = document.getElementById('installButtonText');
  var installHint = document.getElementById('installHint');
  var openButton = document.getElementById('openButton');
  var openButtonText = document.getElementById('openButtonText');
  var introText = document.getElementById('introText');
  var connectionBanner = document.getElementById('connectionBanner');
  var connectionText = document.getElementById('connectionText');
  var updateBanner = document.getElementById('updateBanner');
  var updateText = document.getElementById('updateText');
  var updateButton = document.getElementById('updateButton');
  var launchOverlay = document.getElementById('launchOverlay');
  var launchStatus = document.getElementById('launchStatus');
  var launchLoader = document.getElementById('launchLoader');
  var launchRetry = document.getElementById('launchRetry');
  var installDialog = document.getElementById('installDialog');
  var installInstructions = document.getElementById('installInstructions');

  var userAgent = navigator.userAgent || '';
  var isIPadOS = navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
  var isIOS = /iphone|ipad|ipod/i.test(userAgent) || isIPadOS;
  var isAndroid = /android/i.test(userAgent);
  var prefersReducedMotion = Boolean(
    window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
  var isStandalone = Boolean(
    (window.matchMedia && (
      window.matchMedia('(display-mode: standalone)').matches ||
      window.matchMedia('(display-mode: fullscreen)').matches ||
      window.matchMedia('(display-mode: minimal-ui)').matches
    )) || navigator.standalone === true
  );

  document.documentElement.setAttribute('data-pwa-version', PWA_VERSION);
  try {
    localStorage.setItem('check-se-pwa-version', PWA_VERSION);
  } catch (e) {
    // O controle de versão continua funcionando mesmo sem armazenamento local.
  }

  function updateConnectionState() {
    var offline = navigator.onLine === false;
    connectionBanner.hidden = !offline;

    if (offline) {
      connectionText.textContent = 'Sem conexão. O portal continua disponível; o ambiente online pode exigir internet.';
      installHint.textContent = 'O portal está disponível neste aparelho. Para abrir o ambiente online, reconecte-se ou tente mesmo assim.';
      openButtonText.textContent = 'Tentar abrir o CHECK-SE';
    } else if (isStandalone) {
      installHint.textContent = 'Aplicativo instalado neste aparelho.';
      openButtonText.textContent = 'Abrir CHECK-SE';
    } else {
      installHint.textContent = 'A instalação cria o ícone do CHECK-SE na tela inicial.';
      openButtonText.textContent = 'Continuar sem instalar';
    }
  }

  function showUpdateBanner(message) {
    if (!updateBanner) return;
    updateText.textContent = message || 'Nova versão do aplicativo disponível.';
    updateButton.disabled = false;
    updateButton.textContent = 'Atualizar';
    updateBanner.hidden = false;
  }

  function hideUpdateBanner() {
    if (updateBanner) updateBanner.hidden = true;
  }

  function resetLaunchOverlay() {
    if (launchSlowTimer) {
      window.clearTimeout(launchSlowTimer);
      launchSlowTimer = null;
    }
    launchStatus.textContent = 'Abrindo seu ambiente…';
    launchLoader.hidden = false;
    launchRetry.hidden = true;
    launchRetry.disabled = false;
    launchRetry.textContent = 'Tentar novamente';
  }

  function showLaunchOverlay() {
    resetLaunchOverlay();
    launchOverlay.hidden = false;
    window.requestAnimationFrame(function () {
      launchOverlay.classList.add('show');
    });

    launchSlowTimer = window.setTimeout(function () {
      if (document.visibilityState === 'visible') {
        launchStatus.textContent = 'Está demorando mais que o normal.';
        launchLoader.hidden = true;
        launchRetry.hidden = false;
      }
    }, 8000);
  }

  function navigateToCheckSe(replaceHistory) {
    if (replaceHistory) window.location.replace(APP_URL);
    else window.location.assign(APP_URL);
  }

  function openCheckSe(replaceHistory) {
    showLaunchOverlay();
    window.setTimeout(function () {
      navigateToCheckSe(replaceHistory);
    }, prefersReducedMotion ? 0 : 180);
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

  function watchServiceWorkerRegistration(registration) {
    serviceWorkerRegistration = registration;

    if (registration.waiting && navigator.serviceWorker.controller) {
      showUpdateBanner('Nova versão do aplicativo disponível.');
    }

    registration.addEventListener('updatefound', function () {
      var worker = registration.installing;
      if (!worker) return;

      worker.addEventListener('statechange', function () {
        if (worker.state === 'installed' && navigator.serviceWorker.controller) {
          showUpdateBanner('Nova versão do aplicativo disponível.');
        }
      });
    });

    registration.update().catch(function () {
      // Falha na verificação de atualização não interrompe o portal.
    });
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

  launchRetry.addEventListener('click', function () {
    launchRetry.disabled = true;
    launchRetry.textContent = 'Tentando novamente…';
    launchStatus.textContent = 'Tentando abrir o CHECK-SE novamente…';
    launchLoader.hidden = false;
    navigateToCheckSe(true);
  });

  updateButton.addEventListener('click', function () {
    updateButton.disabled = true;
    updateButton.textContent = 'Atualizando…';

    if (serviceWorkerRegistration && serviceWorkerRegistration.waiting) {
      reloadAfterUpdate = true;
      serviceWorkerRegistration.waiting.postMessage({ type: 'SKIP_WAITING' });
      return;
    }

    window.location.reload();
  });

  window.addEventListener('online', updateConnectionState);
  window.addEventListener('offline', updateConnectionState);
  updateConnectionState();

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('controllerchange', function () {
      if (reloadAfterUpdate) {
        window.location.reload();
        return;
      }
      showUpdateBanner('Nova versão pronta para usar.');
    });

    window.addEventListener('load', function () {
      try {
        var dir = location.pathname.substring(0, location.pathname.lastIndexOf('/') + 1) || '/';
        var swUrl = dir + 'sw.js';
        navigator.serviceWorker.register(swUrl, { scope: dir })
          .then(watchServiceWorkerRegistration)
          .catch(function () {
            // A página continua funcionando normalmente mesmo se o registro falhar.
          });
      } catch (e) {
        navigator.serviceWorker.register('/CHECK-SE/sw.js', { scope: '/CHECK-SE/' })
          .then(watchServiceWorkerRegistration)
          .catch(function () {
            // A página continua funcionando normalmente mesmo se o registro falhar.
          });
      }
    });
  } else {
    hideUpdateBanner();
  }

  var openFromShortcut = new URLSearchParams(window.location.search).get('abrir') === '1';

  if (isStandalone) {
    installButton.hidden = true;
    introText.textContent = navigator.onLine === false
      ? 'O portal continua disponível, mas o ambiente online do CHECK-SE pode exigir conexão.'
      : 'Aplicativo instalado. Abrindo o CHECK-SE…';
    openButtonText.textContent = navigator.onLine === false ? 'Tentar abrir o CHECK-SE' : 'Abrir agora';

    if (navigator.onLine !== false) {
      openCheckSe(true);
    }
  } else if (openFromShortcut && navigator.onLine !== false) {
    openCheckSe(true);
  } else if (isIOS) {
    installButtonText.textContent = isIPadOS || /ipad/i.test(userAgent)
      ? 'Como instalar no iPad'
      : 'Como instalar no iPhone';
  } else if (isAndroid) {
    installButtonText.textContent = 'Como instalar no Android';
  }
}());
