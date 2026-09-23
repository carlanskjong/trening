(function () {
  var pages = Array.prototype.slice.call(document.querySelectorAll('.page'));
  var links = Array.prototype.slice.call(document.querySelectorAll('.tabs a'));
  var names = pages.map(function (p) { return p.id; });
  // sessionStorage, not localStorage: a reload keeps you where you were,
  // but opening the app from the home screen always starts on Home.
  var store = {
    get: function () { try { return sessionStorage.getItem('dash-page'); } catch (e) { return null; } },
    set: function (v) { try { sessionStorage.setItem('dash-page', v); } catch (e) {} }
  };
  function show(name, arg, scroll) {
    if (names.indexOf(name) < 0) { name = names[0]; arg = ''; }
    pages.forEach(function (p) { p.classList.toggle('on', p.id === name); });
    var tab = name === 'run' ? 'runs' : name;      // a run page keeps the Runs tab lit
    links.forEach(function (a) {
      if (a.getAttribute('href') === '#/' + tab) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });
    if (window.pageShown) window.pageShown(name);
    if (name === 'run') {
      if (window.showRun) window.showRun(parseInt(arg, 10));
    } else {
      document.title = 'Trening · ' + name.charAt(0).toUpperCase() + name.slice(1);
      store.set(name);
    }
    if (scroll) window.scrollTo(0, 0);
  }
  function fromHash() { return (location.hash || '').replace(/^#\/?/, '').split('/'); }
  // A new build deploys straight to the phone - no app store, no reinstalling.
  // When the service worker has fetched one, offer a reload.
  if ('serviceWorker' in navigator) {
    var bar = document.getElementById('update');
    var announce = function () {
      bar.hidden = false;
      document.getElementById('updatego').onclick = function () { location.reload(); };
    };
    navigator.serviceWorker.getRegistration().then(function (reg) {
      if (!reg) return;
      if (reg.waiting && navigator.serviceWorker.controller) announce();
      reg.addEventListener('updatefound', function () {
        var fresh = reg.installing;
        if (!fresh) return;
        fresh.addEventListener('statechange', function () {
          if (fresh.state === 'installed' && navigator.serviceWorker.controller) announce();
        });
      });
      var check = function () { reg.update().catch(function () {}); };
      setInterval(check, 15 * 60 * 1000);
      document.addEventListener('visibilitychange', function () {
        if (!document.hidden) check();
      });
    }).catch(function () {});
  }
  window.addEventListener('hashchange', function () { var h = fromHash(); show(h[0], h[1], true); });
  var start = fromHash();
  show(start[0] || store.get() || names[0], start[1], false);
})();

