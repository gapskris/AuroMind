/**
 * AuroBlocks Runtime Initialization (B17.4 Remediation for B17-DEFECT-04)
 *
 * Extracted from games/auroblocks/index.html into a dedicated external script
 * to comply with Content Security Policy `script-src 'self'` without requiring `unsafe-inline`.
 *
 * Execution Order:
 * 1. Stale development cache purge
 * 2. Service worker registration path rewrite
 * 3. Artwork asset URL rewriter (DOM prototype patch + MutationObserver)
 */

// 1. Stale development cache purge
(function () {
  try {
    if ('caches' in window) {
      caches.keys().then(function (names) {
        Promise.all(
          names.map(function (name) {
            return caches.open(name).then(function (cache) {
              return cache.keys().then(function (reqs) {
                var deletions = [];
                for (var i = 0; i < reqs.length; i++) {
                  var url = reqs[i].url || '';
                  if (
                    url.indexOf('/node_modules/') !== -1 ||
                    url.indexOf('/src/') !== -1 ||
                    url.indexOf('/@vite/') !== -1 ||
                    url.indexOf('.tsx') !== -1
                  ) {
                    deletions.push(cache.delete(reqs[i]));
                  }
                }
                return Promise.all(deletions).then(function (res) {
                  return res.length > 0;
                });
              });
            });
          })
        ).then(function (results) {
          var hadStaleDevCache = results.some(Boolean);
          if (hadStaleDevCache && !sessionStorage.getItem('auroblocks_dev_cache_purged')) {
            sessionStorage.setItem('auroblocks_dev_cache_purged', '1');
            window.location.reload();
          } else if (!hadStaleDevCache) {
            sessionStorage.removeItem('auroblocks_dev_cache_purged');
          }
        });
      });
    }
  } catch (e) {}
})();

// 2. Service worker registration path rewrite + active update trigger
if ('serviceWorker' in navigator) {
  const origRegister = navigator.serviceWorker.register.bind(navigator.serviceWorker);
  navigator.serviceWorker.register = function (scriptURL, options) {
    if (scriptURL === '/sw.js' || scriptURL === 'sw.js') {
      return origRegister('./sw.js', Object.assign({}, options, { scope: './', updateViaCache: 'none' }));
    }
    return origRegister(scriptURL, options);
  };
  try {
    navigator.serviceWorker.getRegistration('./').then(function (reg) {
      if (reg && typeof reg.update === 'function') {
        reg.update().catch(function () {});
      }
    }).catch(function () {});
  } catch (e) {}
}

// 2b. Build-Parity Self-Heal Guard: if browser/SW served a stale index.html, purge old SW caches and reload once
(function () {
  try {
    if (typeof fetch !== 'function' || typeof document === 'undefined') return;
    fetch('./precache-manifest.json?_=' + Date.now(), { cache: 'no-store' })
      .then(function (res) {
        return res && res.ok ? res.json() : null;
      })
      .then(function (manifest) {
        if (!manifest || !Array.isArray(manifest.assets)) return;
        var expectedEntry = null;
        for (var i = 0; i < manifest.assets.length; i++) {
          if (/\.\/assets\/index-[a-zA-Z0-9_-]+\.js$/.test(manifest.assets[i])) {
            expectedEntry = manifest.assets[i].replace('./', '');
            break;
          }
        }
        if (!expectedEntry) return;
        var scripts = document.querySelectorAll('script[src*="assets/index-"]');
        if (!scripts || scripts.length === 0) return;
        var currentSrc = scripts[0].getAttribute('src') || '';
        if (currentSrc.indexOf(expectedEntry) !== -1) {
          sessionStorage.removeItem('auroblocks_build_heal');
          return;
        }
        if (sessionStorage.getItem('auroblocks_build_heal') === expectedEntry) return;
        sessionStorage.setItem('auroblocks_build_heal', expectedEntry);

        var cleanupPromise = Promise.resolve();
        if ('caches' in window) {
          cleanupPromise = caches.keys().then(function (names) {
            return Promise.all(
              names.map(function (name) {
                return name.indexOf('auroblocks-') === 0 ? caches.delete(name) : Promise.resolve(false);
              })
            );
          });
        }
        cleanupPromise.finally(function () {
          if ('serviceWorker' in navigator) {
            navigator.serviceWorker.getRegistration('./').then(function (reg) {
              if (reg && reg.update) {
                return reg.update().catch(function () {});
              }
            }).finally(function () {
              window.location.reload();
            });
          } else {
            window.location.reload();
          }
        });
      })
      .catch(function () {});
  } catch (e) {}
})();

// 3. Artwork asset URL rewriter (DOM prototype patch + MutationObserver)
(function () {
  var ARTWORK_PREFIX = '/assets/artwork/';
  var RELATIVE_ARTWORK_PREFIX = './assets/artwork/';
  function rewriteArtworkUrl(value) {
    if (typeof value !== 'string') return value;
    if (value.indexOf(ARTWORK_PREFIX) === 0) {
      return RELATIVE_ARTWORK_PREFIX + value.slice(ARTWORK_PREFIX.length);
    }
    var originPrefix = window.location.origin + ARTWORK_PREFIX;
    if (value.indexOf(originPrefix) === 0) {
      return RELATIVE_ARTWORK_PREFIX + value.slice(originPrefix.length);
    }
    return value;
  }
  try {
    var imgProto = window.HTMLImageElement && window.HTMLImageElement.prototype;
    var srcDesc = imgProto && Object.getOwnPropertyDescriptor(imgProto, 'src');
    if (srcDesc && srcDesc.set && srcDesc.get) {
      Object.defineProperty(imgProto, 'src', {
        configurable: true,
        enumerable: srcDesc.enumerable,
        get: function () {
          return srcDesc.get.call(this);
        },
        set: function (val) {
          return srcDesc.set.call(this, rewriteArtworkUrl(val));
        }
      });
    }
    var origSetAttribute = Element.prototype.setAttribute;
    Element.prototype.setAttribute = function (name, value) {
      if (typeof name === 'string' && name.toLowerCase() === 'src') {
        value = rewriteArtworkUrl(value);
      }
      return origSetAttribute.call(this, name, value);
    };
    if (typeof MutationObserver !== 'undefined') {
      var observer = new MutationObserver(function (mutations) {
        for (var i = 0; i < mutations.length; i++) {
          var m = mutations[i];
          if (m.type === 'attributes' && m.target && m.target.tagName === 'IMG') {
            var raw = m.target.getAttribute('src');
            var fixed = rewriteArtworkUrl(raw);
            if (fixed !== raw) origSetAttribute.call(m.target, 'src', fixed);
          } else if (m.type === 'childList' && m.addedNodes) {
            for (var j = 0; j < m.addedNodes.length; j++) {
              var node = m.addedNodes[j];
              if (node && node.nodeType === 1) {
                if (node.tagName === 'IMG') {
                  var r = node.getAttribute('src');
                  var f = rewriteArtworkUrl(r);
                  if (f !== r) origSetAttribute.call(node, 'src', f);
                } else if (node.querySelectorAll) {
                  var imgs = node.querySelectorAll('img[src^="/assets/artwork/"]');
                  for (var k = 0; k < imgs.length; k++) {
                    var ir = imgs[k].getAttribute('src');
                    origSetAttribute.call(imgs[k], 'src', rewriteArtworkUrl(ir));
                  }
                }
              }
            }
          }
        }
      });
      observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['src']
      });
    }
  } catch (e) {}
})();
