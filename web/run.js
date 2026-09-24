  /* ================================================================
   * One activity: map, numbers, the coach's verdict and the plan check,
   * charts, reps, splits, zones, best efforts, the same route over time, a
   * comparison, and your notes. Drawn in the browser when #/run/<id> opens;
   * an older activity fetches its detail first (loadDetail).
   * ================================================================ */
  var host = document.getElementById('rundetail');

  function pushNotes() { return putEncrypted('notes.enc', NOTES, 'Save run notes'); }

  var FEEL = ['', 'Very easy', 'Easy', 'Easy', 'Comfortable', 'Steady', 'Comfortably hard', 'Hard',
              'Very hard', 'Very, very hard', 'All out'];
  function notesBlock(run) {
    var note = NOTES[run.id] || {}, rpe = +note.rpe || 0;
    var tail = store.token() ? ''
      : '<p class="hint">Notes save on this device straight away. To have them appear on your ' +
        'other devices too, add a GitHub token in <a href="#/settings">Settings</a>.</p>';
    var scale = '';
    for (var i = 1; i <= 10; i++) {
      scale += '<button type="button" data-rpe="' + i + '" class="' + (i === rpe ? 'on' : '') + '" aria-pressed="' +
        (i === rpe) + '" aria-label="' + i + ' - ' + FEEL[i] + '">' + i + '</button>';
    }
    return '<section class="card" id="notecard"><h2>How did it feel?</h2>' +
      '<div class="rpe" role="group" aria-label="How hard it felt, 1 to 10">' + scale + '</div>' +
      '<p class="rpe-say" id="rpesay">' + (rpe ? rpe + ' · ' + FEEL[rpe] : 'Tap how hard it felt, 1 (very easy) to 10 (all out).') + '</p>' +
      '<textarea id="notetext" rows="3" placeholder="Legs, weather, anything worth remembering next time.">' +
      esc(note.text || '') + '</textarea>' +
      '<div class="noterow"><button type="button" id="notesave">Save</button>' +
      '<span id="notestatus" class="hint">' +
      (note.updated ? 'Last saved ' + esc(note.updated.slice(0, 16).replace('T', ' ')) : '') +
      '</span></div>' + tail +
      '<p class="hint">Threshold should feel about 6–7: you can say three words at a time. Easy runs 2–4.</p></section>';
  }

  function wireNotes(run) {
    var text = document.getElementById('notetext');
    var status = document.getElementById('notestatus');
    var saveBtn = document.getElementById('notesave');
    if (!text) return;
    var rpe = +(NOTES[run.id] || {}).rpe || 0;
    document.querySelector('#notecard .rpe').addEventListener('click', function (e) {
      var b = e.target.closest('button[data-rpe]');
      if (!b) return;
      rpe = +b.dataset.rpe === rpe ? 0 : +b.dataset.rpe;
      this.querySelectorAll('button').forEach(function (x) {
        var on = +x.dataset.rpe === rpe;
        x.classList.toggle('on', on); x.setAttribute('aria-pressed', on);
      });
      document.getElementById('rpesay').textContent = rpe ? rpe + ' · ' + FEEL[rpe] : 'Not set.';
      status.textContent = 'Not saved yet.';
    });
    saveBtn.addEventListener('click', async function () {
      saveBtn.disabled = true;
      status.textContent = 'Saving…';
      var body = text.value.trim();
      if (body || rpe) {
        NOTES[run.id] = { text: body, updated: new Date().toISOString() };
        if (rpe) NOTES[run.id].rpe = rpe;
      } else delete NOTES[run.id];
      store.local(NOTES);                       // never lose it, whatever GitHub says
      var res = await pushNotes();
      status.textContent = res.ok ? 'Saved and synced.' : WHY[res.why] || 'Saved on this device.';
      saveBtn.disabled = false;
    });
  }

  // ---------- numbers ----------
  function statGrid(run) {
    var foot = onFoot(run), cells = [];
    if (run.m >= 100) cells.push([(run.m / 1000).toFixed(2), 'km']);
    cells.push([hms(run.s), 'moving']);
    if (run.m >= 500 && run.s) {
      cells.push(foot ? [pace(run.s / (run.m / 1000)), '/km'] : [(run.m / run.s * 3.6).toFixed(1), 'km/h']);
    }
    if (foot && run.gap && run.m >= 500 && Math.abs(run.gap - run.s / (run.m / 1000)) >= 3) {
      cells.push([pace(run.gap), 'GAP /km']);
    }
    if (run.m >= 100) cells.push([run.up + ' m', 'climb']);
    if (run.hr) cells.push([run.hr, 'avg bpm']);
    if (run.mhr) cells.push([run.mhr, 'max bpm']);
    if (run.cad) cells.push([run.cad, foot ? 'steps/min' : 'rpm']);
    if (run.re) cells.push([run.re, 'effort']);
    if (run.cal) cells.push([run.cal, 'kcal']);
    if (run.temp != null && run.temp !== undefined) cells.push([run.temp + '°', 'temperature']);
    if (run.e && run.e > run.s + 30) cells.push([hms(run.e), 'elapsed']);
    var gear = [run.gear, run.dev].filter(Boolean).map(esc).join(' · ');
    return '<div class="stats">' + cells.map(function (c) {
      return '<div><span class="m">' + c[0] + '</span><span class="u">' + c[1] + '</span></div>';
    }).join('') + '</div>' + (gear ? '<p class="gearline">' + gear + '</p>' : '');
  }

  // Time in each zone, one bar per zone - the Strava way of showing it.
  function zoneBlock(run) {
    var keys = ['easy', 'moderate', 'threshold', 'hard'], zs = run.zs || {}, total = 0, top = 0;
    keys.forEach(function (k) { total += zs[k] || 0; top = Math.max(top, zs[k] || 0); });
    if (!total || !run.hs || !run.hs.length) return '';
    var rows = conf.zones.map(function (z) {
      var v = zs[z[0]] || 0, lo = Math.round(conf.maxhr * z[2] / 100), hi = Math.round(conf.maxhr * z[3] / 100) - 1;
      var range = z[2] === 0 ? 'under ' + (hi + 1) : z[3] > 100 ? lo + '+' : lo + '–' + hi;
      return '<div class="zbar"><span class="zb-name"><b>' + z[1] + '</b><small>' + range + ' bpm</small></span>' +
        '<span class="zb-track"><i style="width:' + (v / top * 100).toFixed(1) + '%;background:var(--z-' + z[0] + ')"></i></span>' +
        '<span class="zb-val"><b>' + Math.round(v / total * 100) + '%</b><small>' + hms(v) + '</small></span></div>';
    }).join('');
    return '<section class="card"><h2>Heart-rate zones</h2><div class="zbars">' + rows + '</div>' +
      '<p class="hint">Measured second by second from the strap, not from the average.</p></section>';
  }

  // The work intervals of a session, as bars (pace) with their heart rate.
  function repsBlock(run) {
    if (!run.reps || run.reps.length < 2) return lapsBlock(run, false);
    var rows = run.reps.map(function (r, i) {
      var z = r.hr ? zoneOf(r.hr) : 'nohr';
      return '<tr><td class="num">' + (i + 1) + '</td><td class="num">' + hms(r.s) + '</td>' +
        '<td class="num">' + (r.m >= 1000 ? (r.m / 1000).toFixed(2) + ' km' : r.m + ' m') + '</td>' +
        '<td class="num"><b>' + pace(r.s / (r.m / 1000)) + '</b></td>' +
        '<td class="num"><i class="dot" style="background:var(--z-' + z + ')"></i>' + (r.hr || '-') + '</td>' +
        '<td class="num">' + (r.mhr || '-') + '</td></tr>';
    }).join('');
    var rs = run.rs || {};
    return '<section class="card"><h2>Reps <span class="h2sub">' + rs.n + ' × ' + hms(rs.avg_s) + ' · ' +
      pace(rs.pace) + ' /km · ' + (rs.hr || '-') + ' bpm</span></h2>' +
      '<div class="pc" id="repchart"></div>' +
      '<div class="scroll"><table><tr><th>#</th><th>Time</th><th>Distance</th><th>Pace</th><th>Avg HR</th><th>Max HR</th></tr>' +
      rows + '</table></div><p class="hint">Found from ' + (run.reps[0].lap ? 'your laps' : 'the pace - press the lap button ' +
      'at each rep and short reps show too') + '. Heart rate lags in the first minute of a rep, so short reps often end ' +
      'under ' + Math.round(conf.maxhr * 0.82) + ' - that is not a failure.</p>' + lapsBlock(run, true) + '</section>';
  }
  function repSpec(run) {
    var reps = run.reps, n = reps.length, paces = reps.map(function (r) { return r.s / (r.m / 1000); });
    var lo = Math.min.apply(null, paces), hi = Math.max.apply(null, paces), span = Math.max(hi - lo, 10);
    var t = conf.targets && conf.targets.threshold;
    return {
      label: 'Pace of each rep', h: function (w) { return w > 600 ? 200 : 170; }, zoom: 'x', nearBy: 'x', left: 44,
      x: { lo: 0.4, hi: n + 0.6, minSpan: 3, fmt: function (v) { return '#' + v; },
           ticks: function (a, b) { var o = []; for (var i = Math.ceil(a); i <= b; i++) o.push(i); return o; } },
      y: { lo: lo - span * 0.6, hi: hi + span * 0.4, invert: true, fmt: pace, steps: [2, 5, 10, 15, 30, 60] },
      layers: (t ? [{ type: 'hbands', bands: [{ lo: t.lo, hi: t.hi, key: 'threshold', label: 'Your threshold pace' }] }] : [])
        .concat([{ type: 'line', xs: reps.map(function (_, i) { return i + 1; }), ys: paces, cls: 'pace' },
          { type: 'dots', r: 5, pts: reps.map(function (r, i) {
            return { x: i + 1, y: paces[i], fill: 'var(--z-' + (r.hr ? zoneOf(r.hr) : 'nohr') + ')' };
          }) }]),
      tips: reps.map(function (r, i) {
        return { x: i + 1, y: paces[i], html: 'Rep ' + (i + 1) + '|' + hms(r.s) + ' · ' + pace(paces[i]) + ' /km' +
          (r.hr ? '|' + r.hr + ' bpm average' + (r.mhr ? ', ' + r.mhr + ' max' : '') : '') };
      })
    };
  }

  function lapsBlock(run, folded) {
    if (!run.laps || run.laps.length < 2) return '';
    var rows = run.laps.map(function (l) {
      var p = l.m ? l.s / (l.m / 1000) : 0;
      var hot = l.hr && zoneOf(l.hr) !== 'easy' && zoneOf(l.hr) !== 'moderate';
      return '<tr' + (hot ? ' class="work"' : '') + '><td class="num">' + l.i + '</td>' +
        '<td class="num">' + (l.m >= 1000 ? (l.m / 1000).toFixed(2) + ' km' : l.m + ' m') + '</td>' +
        '<td class="num">' + hms(l.s) + '</td><td class="num">' + pace(p) + '</td>' +
        '<td class="num">' + (l.hr || '-') + '</td><td class="num">' + (l.mhr || '-') + '</td></tr>';
    }).join('');
    var table = '<div class="scroll"><table>' +
      '<tr><th>#</th><th>Distance</th><th>Time</th><th>Pace</th><th>Avg HR</th><th>Max HR</th></tr>' + rows + '</table></div>';
    if (folded) return '<details class="fold"><summary>All ' + run.laps.length + ' laps</summary>' + table + '</details>';
    return '<section class="card"><h2>Laps</h2>' + table + '<p class="hint">Bold rows with the amber edge reached ' +
      'threshold heart rate (' + Math.round(conf.maxhr * 0.82) + '–' + (Math.round(conf.maxhr * 0.88) - 1) + ' bpm).</p></section>';
  }

  function splitsBlock(run) {
    if (!run.sl || !run.sl.length) return '';
    var foot = onFoot(run), paces = run.sl.map(function (s) { return s.s; });
    var fast = Math.min.apply(null, paces), slow = Math.max.apply(null, paces);
    var hasGap = foot && run.sl.some(function (s) { return s.gap; });
    var rows = run.sl.map(function (s) {
      var frac = slow === fast ? 1 : 0.3 + 0.7 * (slow - s.s) / (slow - fast);
      var z = s.hr ? zoneOf(s.hr) : 'nohr';
      return '<div class="split' + (s.s === fast ? ' fastest' : '') + '"><span class="km">' + s.km + '</span>' +
        '<span class="sbar"><i style="width:' + (frac * 100).toFixed(1) + '%"></i></span>' +
        '<span class="sp">' + (foot ? pace(s.s) : (3600 / s.s).toFixed(1)) + '</span>' +
        (hasGap ? '<span class="sg">' + (s.gap ? pace(s.gap) : '') + '</span>' : '') +
        '<span class="su">' + (s.up ? '+' + s.up : '') + '</span>' +
        '<span class="sh"><i class="dot" style="background:var(--z-' + z + ')"></i>' + (s.hr || '-') + '</span></div>';
    }).join('');
    return '<section class="card"><h2>Splits</h2><div class="splits"><div class="split head"><span class="km">km</span>' +
      '<span class="sbar"></span><span class="sp">' + (foot ? 'Pace' : 'km/h') + '</span>' +
      (hasGap ? '<span class="sg">GAP</span>' : '') + '<span class="su">Elev</span><span class="sh">HR</span></div>' + rows +
      '</div><p class="hint">' + (hasGap ? 'GAP is grade-adjusted pace: the pace that effort would have given on the flat ' +
      '(an estimate from the climb, the way Strava does it). ' : '') + 'The dot is the heart-rate zone for that kilometre.</p></section>';
  }

  function chartsBlock(run) {
    if (!run.hs || !run.hs.length) {
      if (!run.sp || !run.sp.length) {
        return '<section class="card"><h2>During the activity</h2><p class="sub">No detail stored for this ' +
          'one yet. The hourly update fetches a batch at a time, newest first.</p></section>';
      }
    }
    var cad = (run.cd || []).some(function (v) { return v; }) && isRun(run);
    return '<section class="card"><h2>During the ' + (isRun(run) ? 'run' : 'activity') + '</h2>' +
      '<p class="readout" id="readout">Slide along the charts to read any point · tap to open</p>' +
      '<div class="charts" id="charts"></div>' +
      '<p class="hint">The marker on the map follows your finger. Open the charts to zoom into a single ' +
      'interval.' + (cad ? ' Cadence dots are red under ' + CAD_LOW + ' steps a minute, amber up to ' + CAD_GOOD +
      ' and green above - it rises with speed, so easy running sits lower than threshold.' : '') + '</p></section>';
  }

  // Strava's best efforts inside this run, with its PR medals.
  function bestBlock(run) {
    if (!run.be || !run.be.length) return '';
    var medal = { 1: 'PR', 2: '2nd', 3: '3rd' };
    var rows = run.be.map(function (e) {
      return '<div class="best"><span class="bn">' + esc(e.n) + '</span><span class="bt">' + hms(e.s) + '</span>' +
        '<span class="bp">' + pace(e.s / (e.m / 1000)) + ' /km</span>' +
        (medal[e.pr] ? '<span class="medal m' + e.pr + '">' + medal[e.pr] + '</span>' : '<span></span>') + '</div>';
    }).join('');
    return '<section class="card"><h2>Best efforts</h2><div class="bests">' + rows + '</div>' +
      '<p class="hint">The fastest stretch of each distance inside this run. PR, 2nd and 3rd are your all-time ' +
      'ranking at the time, from Strava.</p></section>';
  }

  // Every run on the same route: this one against the others over time.
  function routeBlock(run) {
    if (!run.rg || !onFoot(run)) return '';
    var same = runs.filter(function (r) { return r.rg === run.rg && r.m && r.s; });
    if (same.length < 2) return '';
    var fastest = same.slice().sort(function (a, b) { return a.s / a.m - b.s / b.m; })[0];
    return '<section class="card"><h2>This route <span class="h2sub">run ' + same.length + ' times</span></h2>' +
      '<div class="pc" id="routechart"></div>' +
      '<p class="hint">Pace on every run of this route; this one is ringed. Fastest: ' +
      pace(fastest.s / (fastest.m / 1000)) + ' /km on ' + dateText(fastest.dt).split(' · ')[0] +
      (fastest.id === run.id ? ' - this one.' : '.') + ' Heart rate says whether a faster day was fitness or just effort.</p></section>';
  }
  function routeSpec(run) {
    var same = runs.filter(function (r) { return r.rg === run.rg && r.m && r.s; }).slice().reverse();
    var pts = same.map(function (r) {
      return [r.dt.slice(0, 10), r.s / (r.m / 1000), esc(r.n) + '|' + dateText(r.dt).split(' · ')[0] + '|' +
        pace(r.s / (r.m / 1000)) + ' /km' + (r.hr ? ' at ' + r.hr + ' bpm' : '')];
    });
    var sp = trendSpec(pts, 'Pace on this route', pace, { invert: true, steps: [5, 10, 15, 30, 60] });
    if (!sp) return null;
    var me = pts.filter(function (p, i) { return same[i].id === run.id; })[0];
    if (me) sp.layers.push({ type: 'dots', r: 6, pts: [{ x: dayNum(me[0]), y: me[1], cls: 'recent' }] });
    return sp;
  }

  // Pick another activity and lay it over this one.
  function compareCandidates(run) {
    var pool = acts.filter(function (a) { return a.id !== run.id && a.ty === run.ty && (a.t || a.x); });
    // a threshold session is best compared with the same session; anything else with the same route
    var score = function (a) {
      var route = run.rg && a.rg === run.rg, kind = run.k && a.k === run.k, reps = kind && run.rn && a.rn === run.rn;
      if (run.k === 'threshold') return reps ? 0 : kind ? 1 : route ? 2 : 3;
      return route && kind ? 0 : route ? 1 : kind ? 2 : 3;
    };
    return pool.sort(function (a, b) { return score(a) - score(b) || (a.dt < b.dt ? 1 : -1); }).slice(0, 40);
  }
  function compareBlock(run) {
    if (!run.t || !run.t.length) return '';
    var list = compareCandidates(run);
    if (!list.length) return '';
    return '<section class="card" id="cmpcard"><h2>Compare</h2>' +
      '<label class="field"><span>With</span><select id="cmpwith">' + list.map(function (a) {
        return '<option value="' + a.id + '">' + dateText(a.dt).split(' · ')[0].replace(/^\w+ /, '') + ' · ' + esc(a.n) +
          ' · ' + (a.m / 1000).toFixed(1) + ' km' + (a.rg && a.rg === run.rg ? ' · same route' : '') + '</option>';
      }).join('') + '</select></label><div id="cmpbody"><p class="sub">Loading…</p></div></section>';
  }
  function compareTable(a, b) {
    var foot = onFoot(a);
    var rowsDef = [
      ['Distance', function (x) { return x.m / 1000; }, function (v) { return v.toFixed(2) + ' km'; }, 0],
      ['Moving time', function (x) { return x.s; }, hms, 0],
      [foot ? 'Pace' : 'Speed', function (x) { return foot ? x.s / (x.m / 1000) : x.m / x.s * 3.6; },
        foot ? pace : function (v) { return v.toFixed(1) + ' km/h'; }, foot ? -1 : 1],
      ['GAP', function (x) { return x.gap; }, pace, -1],
      ['Avg heart rate', function (x) { return x.hr; }, function (v) { return Math.round(v) + ' bpm'; }, 0],
      ['Reps', function (x) { return x.rs && x.rs.n; }, function (v) { return v; }, 0],
      ['Rep pace', function (x) { return x.rs && x.rs.pace; }, pace, -1],
      ['Rep heart rate', function (x) { return x.rs && x.rs.hr; }, function (v) { return v + ' bpm'; }, 0],
      ['Climb', function (x) { return x.up; }, function (v) { return v + ' m'; }, 0],
      ['Effort', function (x) { return x.re; }, function (v) { return v; }, 0]
    ];
    var rows = rowsDef.map(function (r) {
      var va = r[1](a), vb = r[1](b);
      if (!va && !vb) return '';
      var better = va && vb && r[3] ? (r[3] < 0 ? va < vb : va > vb) : null;
      return '<tr><td>' + r[0] + '</td><td class="num' + (better ? ' better' : '') + '">' + (va ? r[2](va) : '-') +
        '</td><td class="num">' + (vb ? r[2](vb) : '-') + '</td></tr>';
    }).join('');
    return '<div class="scroll"><table class="cmp"><tr><th></th><th>This one</th><th>' +
      esc(dateText(b.dt).split(' · ')[0].replace(/^\w+ /, '')) + '</th></tr>' + rows + '</table></div>';
  }
  function drawCompare(run, other) {
    var body = document.getElementById('cmpbody');
    if (!body) return;
    body.innerHTML = compareTable(run, other) + '<div class="charts" id="cmpcharts"></div>' +
      '<p class="hint">Solid: this one. Dashed grey: the other. Tap the charts to open them and zoom.</p>';
    var box = document.getElementById('cmpcharts');
    var specs = runSpecs(run, other).filter(function (sp) { return sp.key === 'hr' || sp.key === 'pace'; });
    box.innerHTML = specs.map(chartBlock).join('') + '<div class="cgrab"></div>';
    var plots = specs.map(function (sp, i) {
      var p = new Plot(box.querySelectorAll('.cv')[i], sp);
      watchSize(p); p.draw(); return p;
    });
    hands(box.querySelector('.cgrab'), plots, { tap: function () {
      openChartWindow(esc(run.n) + ' vs ' + esc(dateText(other.dt).split(' · ')[0]), function (stack) {
        var sp2 = runSpecs(run, other).filter(function (sp) { return sp.key === 'hr' || sp.key === 'pace'; });
        stack.innerHTML = sp2.map(chartBlock).join('');
        return { plots: sp2.map(function (sp, i) { var p = new Plot(stack.querySelectorAll('.cv')[i], sp); p.headH = 26; return p; }) };
      });
    } });
  }
  function wireCompare(run) {
    var sel = document.getElementById('cmpwith');
    if (!sel) return;
    var go = function () {
      var other = byId[sel.value];
      document.getElementById('cmpbody').innerHTML = '<p class="sub">Loading…</p>';
      loadDetail(other).then(function (o) { if (current === run) drawCompare(run, o); })
        .catch(function () {
          document.getElementById('cmpbody').innerHTML = '<p class="sub">Could not load that one - are you offline?</p>';
        });
    };
    sel.addEventListener('change', go);
    go();
  }

  // The coach's verdict, and how the run matched the planned session.
  function coachBlock(run) {
    var check = window.planCheck ? planCheck(run) : null;
    if (!run.coach && !check) return '';
    var rows = check && check.rows.length ? '<div class="pvd"><div class="pvd-row head"><span></span><span>Planned</span>' +
      '<span>Done</span></div>' + check.rows.map(function (r) {
        return '<div class="pvd-row ' + (r.ok === true ? 'pv-ok' : r.ok === false ? 'pv-off' : '') + '"><span>' + r.what + '</span>' +
          '<span>' + esc(r.planned) + '</span><span>' + esc(r.done) + '<i>' + (r.ok === true ? '✓' : r.ok === false ? '!' : '') +
          '</i></span></div>';
      }).join('') + '</div>' : '';
    return '<section class="card coachcard"><h2>Coach</h2>' +
      (check ? '<p class="plannedas">Planned: <a href="#/plan">' + esc(check.session.title) + '</a></p>' : '') + rows +
      (run.coach ? '<p class="note-coach">' + esc(run.coach) + '</p>' : '') + '</section>';
  }

  // ---------- the map preview on the run page ----------
  function mapCard(run) {
    return '<div class="runmap" id="runmap" role="button" tabindex="0" aria-label="Open the map of this run">' +
      '<div class="rm-canvas"></div>' +
      '<button type="button" class="rm-3d" data-three="1" aria-label="Open in 3D">3D</button>' +
      '<div class="mlegend small" hidden></div></div>';
  }

  /* ---------------- the full-screen map explorer ----------------
   * Drag and pinch; twist with two fingers to turn. Slide two fingers up to tilt and the ground rises
   * into 3D by itself (see autoThree); lay it flat again and it is a plain map. The strip
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
      onPick: function (f) { at(sampleAt(run, f)); },
      onThree: function (on) {
        threeBtn.classList.toggle('on', on);
        threeBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
      }
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

  function header(run) {
    var check = window.planCheck && run.t ? planCheck(run) : null;
    return '<span class="typechip" style="--zc:' + kindColour(run) + '"><i></i>' + esc(kindName(run)) +
      (run.rn ? ' · ' + run.rn + ' reps' : '') + '</span>' +
      (tooHard(run) ? ' <span class="pill warn">grey zone</span>' : '') +
      '<h1 class="runtitle">' + esc(run.n) + '</h1>' +
      '<p class="sub">' + dateText(run.dt) + (check ? ' · planned: ' + esc(check.session.title) : '') + '</p>' +
      (run.desc ? '<p class="desc-quote">' + esc(run.desc) + '</p>' : '');
  }

  function drawRun(run) {
    var geo = routeGeo(run);
    host.innerHTML = header(run) +
      '<section class="card nopad">' + (geo ? mapCard(run) : '') + statGrid(run) + '</section>' +
      coachBlock(run) + chartsBlock(run) + (isRun(run) ? repsBlock(run) : '') + splitsBlock(run) + zoneBlock(run) +
      bestBlock(run) + routeBlock(run) + compareBlock(run) + notesBlock(run) +
      '<p class="hint"><a href="https://www.strava.com/activities/' + run.id +
      '" target="_blank" rel="noopener">Open on Strava ↗</a></p>';

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
      runCharts(box, document.getElementById('readout'), run, function (j) {
        if (preview) preview.showAt(j == null ? null : fractionOfSample(run, j));
      });
    }
    smallChart('repchart', run.reps && run.reps.length >= 2 ? repSpec(run) : null, 'Reps');
    smallChart('routechart', run.rg ? routeSpec(run) : null, 'This route');
    wireCompare(run);
    wireNotes(run);
  }

  // A small chart in a card that opens full screen when tapped.
  function smallChart(id, spec, title) {
    var el = document.getElementById(id);
    if (!el || !spec) { if (el) el.hidden = true; return; }
    el.innerHTML = '<div class="cv"></div><div class="cgrab" role="button" tabindex="0" aria-label="Open ' + title + '"></div>';
    var p = new Plot(el.querySelector('.cv'), spec);
    watchSize(p); p.draw();
    var read = function (q, px, py, cx, cy, touch) { readPoint(q, px, py, cx, cy, touch); };
    hands(el.querySelector('.cgrab'), [p], {
      touchRead: false, probe: read, leave: function () { p.mark(''); tipAt(null); },
      tap: function () {
        tipAt(null);
        openChartWindow(title, function (stack) {
          stack.innerHTML = '<div class="cv"></div>';
          var q = new Plot(stack.querySelector('.cv'), spec);
          q.reset();
          return { plots: [q], maxH: 460, probe: read, leave: function () { q.mark(''); tipAt(null); } };
        });
      }
    });
  }

  window.showRun = function (id) {
    leaveRun();
    var run = byId[id];
    current = run || null;
    if (!run) {
      host.innerHTML = '<section class="card"><p class="sub">That activity is not here - it may have been deleted on Strava.</p></section>';
      return;
    }
    document.title = 'Trening · ' + run.n;
    if (run.x && !run.t) {
      host.innerHTML = header(run) + '<section class="card nopad">' + statGrid(run) + '</section>' +
        '<section class="card"><p class="sub" id="detailwait">Loading the detail…</p></section>';
      loadDetail(run).then(function () { if (current === run) drawRun(run); }).catch(function () {
        var el = document.getElementById('detailwait');
        if (el && current === run) {
          el.textContent = 'Could not load the detail of this one - it needs a connection the first time it is opened.';
        }
      });
    } else {
      drawRun(run);
    }
    pullNotes().then(function () {
      var note = NOTES[run.id], field = document.getElementById('notetext');
      if (field && note && !field.value && document.getElementById('run').classList.contains('on')) {
        field.value = note.text || '';
      }
    });
  };
  window.leaveRun = leaveRun;
