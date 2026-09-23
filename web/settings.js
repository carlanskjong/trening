  /* ================================================================
   * Settings
   *
   * Appearance and map choices are per device: they live in this browser and
   * change the moment you tap them. The training settings change how the
   * dashboard is built, so they go to settings.enc in the repo the same way
   * notes do, and take effect on the next build.
   * ================================================================ */
  function applyTheme(choice) {
    var root = document.documentElement;
    if (choice === 'light' || choice === 'dark') root.setAttribute('data-theme', choice);
    else root.removeAttribute('data-theme');
    var dark = choice === 'dark' ||
      (choice !== 'light' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', dark ? '#0b1117' : '#f2f4f6');
  }
  applyTheme(prefs.get('theme', 'system'));

  function markChosen(group, attr, value) {
    var buttons = document.querySelectorAll('#' + group + ' button');
    for (var i = 0; i < buttons.length; i++) {
      var on = buttons[i].dataset[attr] === value;
      buttons[i].classList.toggle('on', on);
      buttons[i].setAttribute('aria-pressed', on ? 'true' : 'false');
    }
  }
  function choiceGroup(id, attr, key, fallback, after) {
    var el = document.getElementById(id);
    if (!el) return;
    markChosen(id, attr, prefs.get(key, fallback));
    el.addEventListener('click', function (e) {
      var b = e.target.closest('button');
      if (!b) return;
      prefs.set(key, b.dataset[attr]);
      markChosen(id, attr, b.dataset[attr]);
      if (after) after(b.dataset[attr]);
    });
  }

  function wireSettings() {
    if (!document.getElementById('themechoice')) return;
    choiceGroup('themechoice', 'theme', 'theme', 'system', applyTheme);
    choiceGroup('mapchoice', 'map', 'map', 'map');
    markChosen('mapchoice', 'map', savedBasemap());
    choiceGroup('routechoice', 'route', 'route', 'solid');

    var status = document.getElementById('trainingstatus');
    document.getElementById('savetraining').addEventListener('click', async function () {
      var btn = this;
      btn.disabled = true;
      status.textContent = 'Saving…';
      var body = {
        max_hr: parseInt(document.getElementById('setmaxhr').value, 10) || conf.maxhr,
        plan_start: document.getElementById('setstart').value || conf.planStart,
        plan_days: conf.planDays,
        updated: new Date().toISOString()
      };
      var res = await putEncrypted('settings.enc', body, 'Save training settings');
      status.textContent = res.ok
        ? 'Saved. The dashboard rebuilds with it in a few minutes.'
        : (WHY[res.why] || 'Could not save.').replace('Saved on this device. ', '');
      btn.disabled = false;
    });

    var tokenInput = document.getElementById('ghtoken');
    document.getElementById('tokensave').addEventListener('click', async function () {
      var value = tokenInput.value.trim();
      store.token(value);
      shas = {};
      var out = document.getElementById('tokenstatus');
      if (!value) { out.textContent = 'Token removed from this device.'; return; }
      out.textContent = 'Checking…';
      var res = await pushNotes();
      out.textContent = res.ok ? 'Token works - notes, plan and settings now sync.'
        : (WHY[res.why] || 'That did not work.').replace('Saved on this device. ', '');
      tokenInput.value = '';
    });
    if (store.token()) document.getElementById('tokenstatus').textContent = 'A token is saved on this device.';

    document.getElementById('checkupdate').addEventListener('click', function () {
      var out = document.getElementById('updatestatus');
      out.textContent = 'Checking…';
      if (!('serviceWorker' in navigator)) { out.textContent = 'Not supported in this browser.'; return; }
      navigator.serviceWorker.getRegistration().then(function (reg) {
        if (!reg) { out.textContent = 'No app installed yet - add it to your home screen.'; return; }
        return reg.update().then(function () {
          setTimeout(function () {
            out.textContent = document.getElementById('update').hidden
              ? 'You are on the newest version.' : 'A new version is ready - see the bar below.';
          }, 1500);
        });
      }).catch(function () { out.textContent = 'Could not check just now.'; });
    });

    document.getElementById('clearlocal').addEventListener('click', function () {
      try {
        ['dash-pw', 'dash-page', 'dash-notes', 'dash-plan', 'gh-token', 'dash-layer'].forEach(function (k) {
          localStorage.removeItem(k);
        });
        sessionStorage.removeItem('dash-pw');
      } catch (e) {}
      location.reload();
    });
  }
