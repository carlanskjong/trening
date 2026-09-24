  /*
   * Shared by every page: data, formatting, storage, encryption, the pop-out
   * sheet and the chart tooltip. The files in web/ are concatenated in the order
   * report.py lists them, inside one function, so they share these names.
   */
  var runs = window.RUNS || [], conf = window.CONF || {}, byId = {};
  runs.forEach(function (r) { byId[r.id] = r; });

  // ---------- small helpers ----------
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function hms(s) {
    s = Math.round(s || 0);
    var h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
    return h ? h + ':' + pad(m) + ':' + pad(s % 60) : m + ':' + pad(s % 60);
  }
  function pace(sec) {
    if (!isFinite(sec) || sec <= 0 || sec > 1800) return '-';
    sec = Math.round(sec);
    return Math.floor(sec / 60) + ':' + pad(sec % 60);
  }
  function esc(t) { var d = document.createElement('div'); d.textContent = t == null ? '' : t; return d.innerHTML; }
  function zoneOf(hr) {
    var p = hr / conf.maxhr * 100, z = conf.zones;
    for (var i = 0; i < z.length; i++) if (p >= z[i][2] && p < z[i][3]) return z[i][0];
    return 'hard';
  }
  function zoneColor(k) { return 's' + conf.colors[k]; }

  // Dates as plain 'YYYY-MM-DD' strings in local time - the plan works in days, not instants.
  function ymd(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function parseYmd(s) { var p = s.split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); }
  function addDays(s, n) { var d = parseYmd(s); d.setDate(d.getDate() + n); return ymd(d); }
  function mondayOf(s) { var d = parseYmd(s); return addDays(s, -((d.getDay() + 6) % 7)); }
  function weekdayOf(s) { return (parseYmd(s).getDay() + 6) % 7; }
  function daysBetween(a, b) { return Math.round((parseYmd(b) - parseYmd(a)) / 864e5); }
  var TODAY = conf.today || ymd(new Date());
  (function () {                               // the build's "today" is stale by the evening; use the phone's
    var now = ymd(new Date());
    if (now > TODAY) TODAY = now;
  })();

  var prefs = {
    get: function (k, fallback) {
      try { return localStorage.getItem('pref-' + k) || fallback; } catch (e) { return fallback; }
    },
    set: function (k, v) { try { localStorage.setItem('pref-' + k, v); } catch (e) {} }
  };
  function dateText(iso) {
    var d = new Date(iso.replace(' ', 'T'));
    return conf.days[(d.getDay() + 6) % 7] + ' ' + pad(d.getDate()) + '.' + pad(d.getMonth() + 1) + '.' +
      d.getFullYear() + ' · ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }
  // ---------- pop-out ----------
  function openSheet(title, bodyHTML, onMount) {
    var back = document.createElement('div');
    back.className = 'sheet';
    back.innerHTML = '<div class="sheetbox" role="dialog" aria-modal="true" aria-label="' + title + '">' +
      '<div class="sheethead"><b>' + title + '</b>' +
      '<button type="button" class="sheetclose" aria-label="Close">✕</button></div>' +
      '<div class="sheetbody"></div></div>';
    back.querySelector('.sheetbody').innerHTML = bodyHTML;
    document.body.appendChild(back);
    document.body.classList.add('noscroll');
    function close() {
      back.remove();
      document.body.classList.remove('noscroll');
      document.removeEventListener('keydown', onKey);
    }
    function onKey(e) { if (e.key === 'Escape') close(); }
    document.addEventListener('keydown', onKey);
    back.addEventListener('click', function (e) {
      if (e.target === back || e.target.closest('.sheetclose')) close();
    });
    if (onMount) onMount(back.querySelector('.sheetbody'), close);
    return close;
  }

  /* ----------------------------------------------------------------
   * Notes
   *
   * A note lives in notes.enc in the repo, encrypted with the dashboard
   * password - the repo is public, so nothing personal may sit there in the
   * clear. The browser already knows the password (it just decrypted this
   * page), so it can read and write that file itself.
   *
   * Reading needs nothing: notes.enc is public, just unreadable without the
   * password. Writing needs a GitHub token, which is pasted once per device
   * and kept in this browser only.
   * ---------------------------------------------------------------- */
  var NOTES = window.NOTES || {};
  var shas = {}, pulled = false;

  var store = {
    token: function (v) {
      try {
        if (v === undefined) return localStorage.getItem('gh-token') || '';
        if (v) localStorage.setItem('gh-token', v); else localStorage.removeItem('gh-token');
      } catch (e) {}
      return v || '';
    },
    local: function (v) {
      try {
        if (v === undefined) return JSON.parse(localStorage.getItem('dash-notes') || '{}');
        localStorage.setItem('dash-notes', JSON.stringify(v));
      } catch (e) { return {}; }
    },
    password: function () {
      try { return sessionStorage.getItem('dash-pw') || localStorage.getItem('dash-pw') || ''; }
      catch (e) { return ''; }
    }
  };

  function mergeNotes(into, from) {            // newest wins, per run
    Object.keys(from || {}).forEach(function (k) {
      if (!into[k] || (from[k].updated || '') > (into[k].updated || '')) into[k] = from[k];
    });
    return into;
  }
  mergeNotes(NOTES, store.local());

  var b64 = {
    enc: function (bytes) {
      var s = '';
      for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
      return btoa(s);
    },
    dec: function (str) { return Uint8Array.from(atob(str), function (c) { return c.charCodeAt(0); }); }
  };
  var ROUNDS = 250000;

  async function keyFor(password, salt, rounds) {
    var base = await crypto.subtle.importKey('raw', new TextEncoder().encode(password),
      'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey({ name: 'PBKDF2', salt: salt, iterations: rounds, hash: 'SHA-256' },
      base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }
  async function encryptJSON(obj, password) {
    var salt = crypto.getRandomValues(new Uint8Array(16));
    var iv = crypto.getRandomValues(new Uint8Array(12));
    var key = await keyFor(password, salt, ROUNDS);
    var data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv }, key,
      new TextEncoder().encode(JSON.stringify(obj)));
    return JSON.stringify({ salt: b64.enc(salt), iv: b64.enc(iv),
      data: b64.enc(new Uint8Array(data)), rounds: ROUNDS });
  }
  async function decryptJSON(text, password) {
    var blob = JSON.parse(text);
    var key = await keyFor(password, b64.dec(blob.salt), blob.rounds);
    var plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64.dec(blob.iv) }, key,
      b64.dec(blob.data));
    return JSON.parse(new TextDecoder().decode(plain));
  }

  // Pull the newest notes file straight from the repo - no token needed, so a
  // note written on the phone shows up on the PC without waiting for a rebuild.
  // Read one encrypted file from the repo; null when offline, missing or unreadable.
  async function pullEncrypted(path) {
    var pw = store.password();
    if (!pw || !conf.repo) return null;
    try {
      var r = await fetch('https://raw.githubusercontent.com/' + conf.repo + '/main/' + path,
        { cache: 'no-store' });
      if (!r.ok) return null;
      return await decryptJSON(await r.text(), pw);
    } catch (e) { return null; }       /* offline, no file yet, or a different password - not fatal */
  }
  async function pullNotes() {
    if (pulled) return;
    pulled = true;
    mergeNotes(NOTES, await pullEncrypted('notes.enc'));
  }

  // Write one encrypted file into the repo. Notes and settings both use this.
  async function putEncrypted(path, obj, message) {
    var token = store.token(), pw = store.password();
    if (!token) return { ok: false, why: 'no-token' };
    if (!pw) return { ok: false, why: 'no-password' };
    if (!conf.repo) return { ok: false, why: 'no-repo' };
    var api = 'https://api.github.com/repos/' + conf.repo + '/contents/' + path;
    var head = { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json' };
    try {
      if (shas[path] === undefined) {          // find the file's current version first
        var get = await fetch(api + '?ref=main', { headers: head, cache: 'no-store' });
        if (get.ok) shas[path] = (await get.json()).sha;
        else if (get.status === 404) shas[path] = '';
        else return { ok: false, why: get.status === 401 || get.status === 403 ? 'bad-token' : 'http' };
      }
      var body = { message: message, content: btoa(unescape(encodeURIComponent(
        await encryptJSON(obj, pw)))), branch: 'main' };
      if (shas[path]) body.sha = shas[path];
      var put = await fetch(api, { method: 'PUT', headers: head, body: JSON.stringify(body) });
      if (put.status === 409 || put.status === 422) {
        delete shas[path];
        return { ok: false, why: 'conflict' };
      }
      if (!put.ok) return { ok: false, why: put.status === 401 || put.status === 403 ? 'bad-token' : 'http' };
      shas[path] = (await put.json()).content.sha;
      return { ok: true };
    } catch (e) {
      return { ok: false, why: 'offline' };
    }
  }


  var WHY = {
    'no-token': 'Saved on this device. Add a GitHub token in Settings to sync it to your other devices.',
    'no-password': 'Saved on this device only - reopen the dashboard with your password to sync.',
    'no-repo': 'Saved on this device only - this build does not know which repo to write to.',
    'bad-token': 'Saved on this device. GitHub refused the token - check it has Contents: read and write.',
    'conflict': 'Saved on this device. The file changed elsewhere - try again.',
    'offline': 'Saved on this device. No connection to GitHub right now - it syncs next time.',
    'http': 'Saved on this device. GitHub would not accept the change.'
  };

  // The floating tooltip the charts use (see tipAt in charts.js).
  var tipEl = document.getElementById('tip');
