  /* ================================================================
   * One run: map, numbers, charts, laps, splits, zones and your notes.
   * Drawn in the browser from window.RUNS when #/run/<id> is opened.
   * ================================================================ */
  var host = document.getElementById('rundetail');

  function pushNotes() { return putEncrypted('notes.enc', NOTES, 'Save run notes'); }

  function notesBlock(run) {
    var note = NOTES[run.id] || {};
    var tail = store.token() ? ''
      : '<p class="hint">Notes save on this device straight away. To have them appear on your ' +
        'other devices too, add a GitHub token in <a href="#/settings">Settings</a>.</p>';
    return '<section class="card" id="notecard"><h2>Your notes</h2>' +
      '<textarea id="notetext" rows="4" placeholder="How did it feel? Legs, weather, anything worth ' +
      'remembering next time.">' + esc(note.text || '') + '</textarea>' +
      '<div class="noterow"><button type="button" id="notesave">Save</button>' +
      '<span id="notestatus" class="hint">' +
      (note.updated ? 'Last saved ' + esc(note.updated.slice(0, 16).replace('T', ' ')) : '') +
      '</span></div>' + tail + '</section>';
  }

  function wireNotes(run) {
    var text = document.getElementById('notetext');
    var status = document.getElementById('notestatus');
    var saveBtn = document.getElementById('notesave');
    if (!text) return;
    saveBtn.addEventListener('click', async function () {
      saveBtn.disabled = true;
      status.textContent = 'Saving…';
      var body = text.value.trim();
      if (body) NOTES[run.id] = { text: body, updated: new Date().toISOString() };
      else delete NOTES[run.id];
      store.local(NOTES);                       // never lose it, whatever GitHub says
      var res = await pushNotes();
      status.textContent = res.ok ? 'Saved and synced.' : WHY[res.why] || 'Saved on this device.';
      saveBtn.disabled = false;
    });
  }

  // ---------- numbers ----------
  function statGrid(run) {
    var cells = [
      [(run.m / 1000).toFixed(2), 'km'],
      [hms(run.s), 'moving'],
      [pace(run.s / (run.m / 1000)), '/km'],
      [run.up + ' m', 'climb']
    ];
    if (run.hr) cells.push([run.hr, 'avg bpm']);
    if (run.mhr) cells.push([run.mhr, 'max bpm']);
    if (run.cad) cells.push([run.cad, 'steps/min']);
    if (run.re) cells.push([run.re, 'effort']);
    if (run.e && run.e > run.s + 30) cells.push([hms(run.e), 'elapsed']);
    return '<div class="stats">' + cells.map(function (c) {
      return '<div><span class="m">' + c[0] + '</span><span class="u">' + c[1] + '</span></div>';
    }).join('') + '</div>';
  }

  function zoneBlock(run) {
    var total = 0, keys = conf.order, i;
    for (i = 0; i < keys.length; i++) total += run.zs[keys[i]] || 0;
    if (!total) return '';
    var bar = '', list = '';
    for (i = 0; i < keys.length; i++) {
      var v = run.zs[keys[i]] || 0;
      if (!v) continue;
      bar += '<div class="bar-seg ' + zoneColor(keys[i]) + '" style="width:' + (v / total * 100).toFixed(2) + '%"></div>';
      list += '<div class="zrow"><span><i class="dot ' + zoneColor(keys[i]) + '"></i>' + conf.names[keys[i]] +
        '</span><span class="num">' + hms(v) + ' · ' + Math.round(v / total * 100) + '%</span></div>';
    }
    return '<section class="card"><h2>Time in zones</h2><div class="bar">' + bar + '</div>' +
      '<div class="zlist">' + list + '</div>' +
      '<p class="hint">Measured second by second from the heart-rate strap, not from the run’s average.</p></section>';
  }

  function lapsBlock(run) {
    if (!run.laps || run.laps.length < 2) return '';
    var rows = run.laps.map(function (l) {
      var p = l.m ? l.s / (l.m / 1000) : 0;
      var hot = l.hr && zoneOf(l.hr) !== 'easy' && zoneOf(l.hr) !== 'moderate';
      return '<tr' + (hot ? ' class="work"' : '') + '><td class="num">' + l.i + '</td>' +
        '<td class="num">' + (l.m >= 1000 ? (l.m / 1000).toFixed(2) + ' km' : l.m + ' m') + '</td>' +
        '<td class="num">' + hms(l.s) + '</td><td class="num">' + pace(p) + '</td>' +
        '<td class="num">' + (l.hr || '-') + '</td><td class="num">' + (l.mhr || '-') + '</td></tr>';
    }).join('');
    return '<section class="card"><h2>Laps</h2><div class="scroll"><table>' +
      '<tr><th>#</th><th>Distance</th><th>Time</th><th>Pace</th><th>Avg HR</th><th>Max HR</th></tr>' +
      rows + '</table></div><p class="hint">Bold rows with the amber edge reached threshold heart rate (' +
      Math.round(conf.maxhr * 0.82) + '–' + (Math.round(conf.maxhr * 0.88) - 1) + ' bpm). A rep that stayed ' +
      'under is not a failure - heart rate lags in the first minute, so short reps often finish just below.</p></section>';
  }

  function splitsBlock(run) {
    if (!run.sl || !run.sl.length) return '';
    var paces = run.sl.map(function (s) { return s.s; });
    var fast = Math.min.apply(null, paces), slow = Math.max.apply(null, paces);
    var rows = run.sl.map(function (s) {
      var frac = slow === fast ? 1 : 0.25 + 0.75 * (slow - s.s) / (slow - fast);
      var cls = s.hr ? zoneColor(zoneOf(s.hr)) : 's0';
      return '<div class="split"><span class="km">' + s.km + '</span>' +
        '<span class="sbar"><i class="' + cls + '" style="width:' + (frac * 100).toFixed(1) + '%"></i></span>' +
        '<span class="sp">' + pace(s.s) + '</span><span class="sh">' + (s.hr || '-') + '</span></div>';
    }).join('');
    return '<section class="card"><h2>Kilometre splits</h2><div class="splits">' + rows +
      '</div><p class="hint">Bar length is relative pace; colour is the heart-rate zone for that kilometre.</p></section>';
  }

  function chartsBlock(run) {
    if (!run.hs || !run.hs.length) {
      return '<section class="card"><h2>Heart rate</h2><p class="sub">No heart-rate detail stored for this ' +
        'run yet. The hourly update fetches a few runs at a time.</p></section>';
    }
    return '<section class="card"><h2>During the run' +
      '<button type="button" class="more" id="chartbig">Bigger ⤢</button></h2>' +
      '<p class="readout" id="readout"></p>' +
      '<div class="charts" id="charts" data-count="' + run.hs.length + '">' +
      chartsHTML(run, 0, run.hs.length, false) + '</div>' +
      '<p class="hint">Move across the charts and the marker follows on the map. Tap to open them bigger, ' +
      'where you can zoom into a single interval.</p></section>';
  }

  // ---------- the map preview on the run page ----------
  function mapCard(run) {
    return '<div class="runmap" id="runmap" role="button" tabindex="0" aria-label="Open the map of this run">' +
      '<div class="rm-canvas"></div>' +
      '<button type="button" class="rm-3d" data-three="1" aria-label="Open in 3D">3D</button>' +
      '<span class="rm-open">' + micon('expand') + 'Explore map</span>' +
      '<div class="mlegend small" hidden></div></div>';
  }

  /* ---------------- the full-screen map explorer ----------------
   * Drag, pinch, and in 3D twist with two fingers to turn and tilt. The strip
   * at the bottom is the run's profile: slide along it and the marker walks
   * the route; tap the route and the strip jumps to that point.
   * -------------------------------------------------------------- */
  function profileSVG(run) {
    var W = 760, H = 96, n = (run.d || []).length;
    if (n < 8) return '';
    var alt = run.al && run.al.length === n ? run.al : null, hr = run.hs && run.hs.length === n ? run.hs : null;
    var x = function (i) { return (i / (n - 1) * W).toFixed(1); };
    var out = '';
    if (alt) {
      var lo = Math.min.apply(null, alt.filter(isFinite)), hi = Math.max.apply(null, alt.filter(isFinite));
      var span = Math.max(hi - lo, 25);
      var y = function (v) { return (H - 6 - (v - lo) / span * (H - 26)).toFixed(1); };
      var d = 'M0 ' + H;
      for (var i = 0; i < n; i++) if (alt[i] != null) d += ' L' + x(i) + ' ' + y(alt[i]);
      out += '<path d="' + d + ' L' + W + ' ' + H + ' Z" class="pf-area"/>';
    }
    if (hr) {
      var h0 = conf.maxhr * 0.45, h1 = conf.maxhr;
      var yh = function (v) { return (H - 4 - (v - h0) / (h1 - h0) * (H - 12)).toFixed(1); };
      var seg = '', prev = null;
      for (var j = 0; j < n; j++) {
        if (!hr[j]) { prev = null; continue; }
        var z = zoneOf(hr[j]);
        if (prev !== null) seg += '<line x1="' + x(j - 1) + '" y1="' + yh(hr[j - 1]) + '" x2="' + x(j) + '" y2="' + yh(hr[j]) +
          '" class="pf-hr" style="stroke:var(--z-' + z + ')"/>';
        prev = z;
      }
      out += seg;
    }
    return '<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" aria-hidden="true">' + out +
      '<line class="pf-cur" x1="0" x2="0" y1="0" y2="' + H + '" style="opacity:0"/></svg>';
  }

  function readoutAt(run, j) {
    var bits = [run.d && run.d[j] != null ? (run.d[j] / 1000).toFixed(2) + ' km' : null,
      run.hs && run.hs[j] ? run.hs[j] + ' bpm' : null,
      run.sp && run.sp[j] > 40 ? pace(100000 / run.sp[j]) + ' /km' : null,
      run.cd && run.cd[j] ? run.cd[j] + ' spm' : null,
      run.al && run.al[j] != null ? Math.round(run.al[j]) + ' m' : null,
      run.t && run.t[j] != null ? hms(run.t[j]) : null];
    return bits.filter(Boolean).join('  ·  ');
  }

  var explorerOpen = null;
  function openExplorer(run, three) {
    if (!routeGeo(run)) return;
    if (explorerOpen) explorerOpen();
    var styles = stylesFor(run);
    var hasProfile = (run.d || []).length >= 8;
    var root = document.createElement('div');
    root.className = 'mview';
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.setAttribute('aria-label', 'Map of ' + run.n);
    root.innerHTML =
      '<div class="mv-mapwrap"><div class="mv-map"></div><div class="mlegend" hidden></div></div>' +
      '<div class="mv-top"><button type="button" class="mbtn" data-act="close" aria-label="Close the map">' +
      micon('close') + '</button><div class="mv-title"><b>' + esc(run.n) + '</b><span>' +
      (run.m / 1000).toFixed(1) + ' km · ' + dateText(run.dt).split(' · ')[0] + '</span></div></div>' +
      '<div class="mv-side">' +
      '<button type="button" class="mbtn txt" data-act="3d" aria-pressed="false" aria-label="3D terrain">3D</button>' +
      '<button type="button" class="mbtn" data-act="basemap" aria-label="Background map" aria-haspopup="menu">' + micon('layers') + '</button>' +
      '<button type="button" class="mbtn" data-act="style" aria-label="How the route is drawn" aria-haspopup="menu">' + micon('line') + '</button>' +
      '<button type="button" class="mbtn" data-act="fit" aria-label="Show the whole route">' + micon('fit') + '</button>' +
      '<button type="button" class="mbtn" data-act="north" aria-label="Face north" hidden>' + micon('compass') + '</button>' +
      '</div>' +
      menuHTML('basemap', BASEMAPS.map(function (b) { return { id: b.id, name: b.name, hint: b.hint }; })) +
      menuHTML('style', styles.map(function (s) { return { id: s.id, name: s.name, hint: s.hint, swatch: styleSwatch(s.id) }; })) +
      (hasProfile ? '<div class="mv-panel"><p class="mv-read">Slide along the profile to follow the run.</p>' +
        '<div class="mv-prof" aria-label="Profile of the run - slide to move the marker">' + profileSVG(run) + '</div></div>' : '');
    document.body.appendChild(root);
    document.body.classList.add('noscroll');

    var legend = root.querySelector('.mlegend'), read = root.querySelector('.mv-read');
    var prof = root.querySelector('.mv-prof'), cur = prof && prof.querySelector('.pf-cur');
    var threeBtn = root.querySelector('[data-act="3d"]'), north = root.querySelector('[data-act="north"]');

    function mark(kind, id) {
      root.querySelectorAll('[data-menu="' + kind + '"] button').forEach(function (b) {
        var on = b.dataset[kind] === id;
        b.classList.toggle('on', on); b.setAttribute('aria-checked', on ? 'true' : 'false');
      });
    }
    function at(j) {
      if (j < 0) return;
      if (read) read.textContent = readoutAt(run, j);
      if (cur) {
        var px = (j / Math.max((run.d || []).length - 1, 1) * 760).toFixed(1);
        cur.setAttribute('x1', px); cur.setAttribute('x2', px); cur.style.opacity = 1;
      }
      rm.showAt(fractionOfSample(run, j));
    }

    var rm = new RunMap(root.querySelector('.mv-map'), run, {
      interactive: true, three: !!three, padding: 60,
      onLegend: function (drawn) {
        legend.hidden = !drawn.legend;
        legend.innerHTML = legendHTML(drawn.legend);
        mark('style', drawn.style.id);
      },
      onPick: function (f) { at(sampleAt(run, f)); }
    });
    threeBtn.classList.toggle('on', !!three);
    threeBtn.setAttribute('aria-pressed', three ? 'true' : 'false');
    mark('basemap', rm.basemap);
    rm.ready.then(function (map) {
      if (!map) return;
      var turn = function () {
        north.hidden = Math.abs(map.getBearing()) < 1 && map.getPitch() < 1;
      };
      map.on('rotate', turn); map.on('pitch', turn);
      map.once('idle', turn);
    }).catch(function () {
      root.querySelector('.mv-map').innerHTML = '<p class="mv-fail">The map could not load. ' +
        'Check your connection and open it again.</p>';
    });

    function closeMenus(except) {
      root.querySelectorAll('.mpop').forEach(function (m) { if (m.dataset.menu !== except) m.hidden = true; });
    }
    root.addEventListener('click', function (e) {
      var b = e.target.closest('button');
      if (!b) { if (!e.target.closest('.mpop')) closeMenus(); return; }
      if (b.dataset.basemap) { rm.setBasemap(b.dataset.basemap); mark('basemap', b.dataset.basemap); closeMenus(); return; }
      if (b.dataset.style) { rm.setStyle(b.dataset.style); closeMenus(); return; }
      var act = b.dataset.act;
      if (act === 'close') return close();
      if (act === 'basemap' || act === 'style') {
        var menu = root.querySelector('[data-menu="' + act + '"]');
        closeMenus(act); menu.hidden = !menu.hidden; return;
      }
      closeMenus();
      if (act === '3d') {
        var on = !rm.three; rm.set3D(on);
        b.classList.toggle('on', on); b.setAttribute('aria-pressed', on ? 'true' : 'false');
      } else if (act === 'fit') rm.fit(true);
      else if (act === 'north' && rm.map) rm.map.easeTo({ bearing: 0, pitch: rm.three ? rm.map.getPitch() : 0, duration: 600 });
    });

    if (prof) {
      var n = run.d.length;
      var slide = function (e) {
        var r = prof.getBoundingClientRect();
        at(Math.round(Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * (n - 1)));
      };
      prof.addEventListener('pointerdown', function (e) { prof.setPointerCapture(e.pointerId); slide(e); });
      prof.addEventListener('pointermove', function (e) { if (prof.hasPointerCapture(e.pointerId)) slide(e); });
    }

    function onKey(e) { if (e.key === 'Escape') close(); }
    document.addEventListener('keydown', onKey);
    function close() {
      rm.destroy();
      root.remove();
      document.body.classList.remove('noscroll');
      document.removeEventListener('keydown', onKey);
      explorerOpen = null;
    }
    explorerOpen = close;
  }

  // ---------- the run page ----------
  var current = null, preview = null;

  function leaveRun() {
    if (preview) { preview.destroy(); preview = null; }
    if (explorerOpen) explorerOpen();
  }

  window.showRun = function (id) {
    leaveRun();
    var run = byId[id];
    current = run || null;
    if (!run) {
      host.innerHTML = '<section class="card"><p class="sub">That run is not in the last 140 days.</p></section>';
      return;
    }
    document.title = 'Trening · ' + run.n;
    var geo = routeGeo(run);
    host.innerHTML =
      '<span class="typechip" style="--zc:var(--z-' + (run.z === 'nohr' ? 'nohr' : run.z) + ')"><i></i>' +
      conf.names[run.z] + '</span>' +
      '<h1 class="runtitle">' + esc(run.n) + '</h1>' +
      '<p class="sub">' + dateText(run.dt) + '</p>' +
      '<section class="card nopad">' + (geo ? mapCard(run) : '') + statGrid(run) + '</section>' +
      chartsBlock(run) + lapsBlock(run) + splitsBlock(run) + zoneBlock(run) + notesBlock(run) +
      '<p class="hint"><a href="https://www.strava.com/activities/' + run.id +
      '" target="_blank" rel="noopener">Open this run on Strava ↗</a></p>';

    if (geo) {
      var card = document.getElementById('runmap');
      var lg = card.querySelector('.mlegend');
      preview = new RunMap(card.querySelector('.rm-canvas'), run, {
        interactive: false, padding: 30,
        onLegend: function (drawn) { lg.hidden = !drawn.legend; lg.innerHTML = legendHTML(drawn.legend); }
      });
      preview.ready.catch(function () {
        card.querySelector('.rm-canvas').innerHTML = '<p class="mv-fail">Map unavailable offline.</p>';
      });
      card.addEventListener('click', function (e) { openExplorer(run, !!e.target.closest('[data-three]')); });
      card.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openExplorer(run, false); }
      });
    }

    var box = document.getElementById('charts');
    if (box) {
      var out = document.getElementById('readout');
      out.dataset.idle = 'Move across the chart to read any point.';
      out.textContent = out.dataset.idle;
      box.dataset.from = 0;
      attachProbe(box, box, out, run, function (j) {
        if (preview) preview.showAt(j == null ? null : fractionOfSample(run, j));
      });
      var slid = 0, startX = 0;
      box.addEventListener('touchstart', function (e) {
        slid = 0; startX = e.touches[0].clientX;
      }, { passive: true });
      box.addEventListener('touchmove', function (e) {
        slid = Math.max(slid, Math.abs(e.touches[0].clientX - startX));
      }, { passive: true });
      box.addEventListener('click', function () {
        if (slid > 10) { slid = 0; return; }     // that was a scrub, not a tap
        openCharts(run);
      });
      document.getElementById('chartbig').addEventListener('click', function (e) {
        e.stopPropagation();
        openCharts(run);
      });
    }
    wireNotes(run);
    pullNotes().then(function () {
      var note = NOTES[run.id];
      var field = document.getElementById('notetext');
      if (field && note && !field.value && document.getElementById('run').classList.contains('on')) {
        field.value = note.text || '';
      }
    });
  };
  window.leaveRun = leaveRun;
