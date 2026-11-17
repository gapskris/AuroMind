if ('serviceWorker' in navigator) {
  const origRegister = navigator.serviceWorker.register.bind(navigator.serviceWorker);
  navigator.serviceWorker.register = function(scriptURL, options) {
    const normalizedOptions = (options && options.scope === '/')
      ? Object.assign({}, options, { scope: './' })
      : options;
    if (typeof scriptURL === 'string' && scriptURL.indexOf('offline-shell-sw.js') !== -1) {
      return origRegister('./sw.js', Object.assign({}, normalizedOptions, { scope: './' }));
    }
    return origRegister(scriptURL, normalizedOptions);
  };
  window.addEventListener('load', () => { navigator.serviceWorker.register('./sw.js', { scope: './' }); });
}
