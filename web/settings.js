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

    // Both cards write the same file, so each save sends everything.
    var race = conf.race ? { name: conf.race.name, date: conf.race.date, m: conf.race.m, goal: conf.race.goal } : null;
    async function saveSettings(btn, status) {
      btn.disabled = true;
      status.textContent = 'Saving…';
      var body = {
        max_hr: parseInt(document.getElementById('setmaxhr').value, 10) || conf.maxhr,
        updated: new Date().toISOString()
      };
      if (race) body.race = race;
      var res = await putEncrypted('settings.enc', body, 'Save training settings');
      status.textContent = res.ok
        ? 'Saved. The dashboard rebuilds with it in a few minutes.'
        : (WHY[res.why] || 'Could not save.').replace('Saved on this device. ', '');
      btn.disabled = false;
    }
    var status = document.getElementById('trainingstatus');
    document.getElementById('savetraining').addEventListener('click', function () { saveSettings(this, status); });

    var raceStatus = document.getElementById('racestatus'), dist = document.getElementById('racedist');
    dist.addEventListener('change', function () { document.getElementById('raceotherbox').hidden = dist.value !== 'other'; });
    function seconds(txt) {
      var p = String(txt || '').trim().split(':').map(Number);
      if (!p[0] && p.length < 2 || p.some(isNaN)) return null;
      return p.length === 3 ? p[0] * 3600 + p[1] * 60 + p[2] : p.length === 2 ? p[0] * 60 + p[1] : null;
    }
    document.getElementById('saverace').addEventListener('click', function () {
      var name = document.getElementById('racename').value.trim(), date = document.getElementById('racedate').value;
      var m = dist.value === 'other' ? parseFloat(document.getElementById('raceother').value) * 1000 : parseFloat(dist.value);
      if (!date || !(m >= 400)) { raceStatus.textContent = 'Needs a date and a distance.'; return; }
      var goalTxt = document.getElementById('racegoal').value, goal = seconds(goalTxt);
      if (goalTxt.trim() && !goal) { raceStatus.textContent = 'Write the goal as h:mm:ss or mm:ss.'; return; }
      race = { name: name || 'Race', date: date, m: m, goal: goal };
      document.getElementById('clearrace').hidden = false;
      saveSettings(this, raceStatus);
    });
    document.getElementById('clearrace').addEventListener('click', function () {
      race = null;
      this.hidden = true;
      saveSettings(this, raceStatus);
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

    // Start a build now instead of waiting: the same thing Strava's doorbell does.
    var refreshOut = document.getElementById('refreshstatus');
    document.getElementById('refreshnow').addEventListener('click', async function () {
      var btn = this, token = store.token();
      if (!token) { refreshOut.textContent = 'Needs the GitHub token (further down).'; return; }
      if (!conf.repo) { refreshOut.textContent = 'This build does not know which repository it comes from.'; return; }
      btn.disabled = true;
      refreshOut.textContent = 'Asking GitHub…';
      try {
        var r = await fetch('https://api.github.com/repos/' + conf.repo + '/actions/workflows/update.yaml/dispatches', {
          method: 'POST',
          headers: { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json' },
          body: JSON.stringify({ ref: 'main', inputs: { reason: 'Refresh from the app' } })
        });
        if (r.status === 204) {
          refreshOut.textContent = 'Started. New runs arrive in about two minutes - the "Update ready" bar appears when they do.';
          watchForUpdate();
        } else if (r.status === 403 || r.status === 404) {
          refreshOut.textContent = 'GitHub said no: the token needs "Actions: Read and write" as well (see the steps in the update notes).';
        } else if (r.status === 401) {
          refreshOut.textContent = 'GitHub did not accept the token - it may have expired.';
        } else {
          refreshOut.textContent = 'GitHub answered ' + r.status + '. Try again in a minute.';
        }
      } catch (e) {
        refreshOut.textContent = 'No connection to GitHub right now.';
      }
      btn.disabled = false;
    });
    // Look for the new version every 30 s for a while, so the bar shows as soon as it is live.
    function watchForUpdate() {
      if (!('serviceWorker' in navigator)) return;
      var tries = 0;
      var tick = setInterval(function () {
        if (++tries > 16 || !document.getElementById('update').hidden) { clearInterval(tick); return; }
        navigator.serviceWorker.getRegistration().then(function (reg) { if (reg) reg.update().catch(function () {}); });
      }, 30000);
    }

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
