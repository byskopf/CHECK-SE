/* Configuração única do portal antigo do CHECK-SE, que agora leva ao aplicativo CHECK-SELT.
   Atualize este arquivo quando mudar a versão do PWA ou a implantação do Apps Script. */
var CHECK_SE_CONFIG = Object.freeze({
  version: '1.6.0',
  iconVersion: '20260915',
  appUrl: 'https://script.google.com/macros/s/AKfycbzo_WN_PzoRhS-LhV070vmE8GDr1vJX9qEa1iqxADe6kVhNZa968olZLVVDAtObmvE/exec'
});

if (typeof module !== 'undefined' && module.exports) {
  module.exports = CHECK_SE_CONFIG;
}
