  /* ================================================================
   * The plan: sessions you can move, change, add and remove.
   *
   * The build sends the standard plan (the threshold progression) and, when
   * you have edited it, your saved version from plan.enc. The first edit
   * copies the standard plan into your own; after that your version wins,
   * and weeks beyond it keep following the standard plan. Edits are saved on
   * this device at once and to plan.enc in the repo shortly after, the same
   * way notes are, so the phone and the PC agree.
   * ================================================================ */
  var PLAN = window.PLAN || { standard: { sessions: [], until: '' }, saved: null };
  var TYPES = {
    easy: { name: 'Easy run', short: 'Easy', zone: 'easy' },
    long: { name: 'Long run', short: 'Long', zone: 'easy' },
    threshold: { name: 'Threshold', short: 'Thr', zone: 'threshold' },
    race: { name: 'Race', short: 'Race', zone: 'hard' },
    other: { name: 'Other', short: 'Other', zone: 'nohr' }
  };
  var DAYS_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September',
    'October', 'November', 'December'];

  function targetFor(type) {
    var m = conf.maxhr;
    if (type === 'threshold') return Math.round(m * 0.82) + '–' + (Math.round(m * 0.88) - 1) + ' bpm';
    if (type === 'easy' || type === 'long') return 'under ' + Math.round(m * 0.75) + ' bpm';
    return '';
  }
  function dm(s) { var d = parseYmd(s); return pad(d.getDate()) + '.' + pad(d.getMonth() + 1); }
  function dayName(s) { return conf.days[weekdayOf(s)]; }
  function whenWord(s) {
    var n = daysBetween(TODAY, s);
    return n === 0 ? 'Today' : n === 1 ? 'Tomorrow' : n === -1 ? 'Yesterday' : dayName(s);
  }
  // Calendar (ISO) week number - the plan is written week by week that way.
  function isoWeek(s) {
    var d = parseYmd(s);
    d.setDate(d.getDate() + 3 - (d.getDay() + 6) % 7);          // the Thursday decides the year
    var jan4 = new Date(d.getFullYear(), 0, 4);
    return 1 + Math.round(((d - jan4) / 864e5 - 3 + (jan4.getDay() + 6) % 7) / 7);
  }

  /* ---------------- your version of the plan ---------------- */
  var planStore = {
    get: function () { try { return JSON.parse(localStorage.getItem('dash-plan') || 'null'); } catch (e) { return null; } },
    set: function (v) { try { localStorage.setItem('dash-plan', JSON.stringify(v)); } catch (e) {} }
  };
  function newest(a, b) {
    if (!a) return b || null;
    if (!b) return a;
    return (b.updated || '') > (a.updated || '') ? b : a;
  }
  // Edits belong to the version of the plan they were made on; a new plan
  // (a new block) replaces them rather than hiding under them.
  function sameVersion(p) { return p && (p.reset || p.version === PLAN.standard.version) ? p : null; }
  var mine = sameVersion(newest(PLAN.saved, planStore.get()));

  function sessions() {
    if (!mine || mine.reset) return PLAN.standard.sessions;
    var tail = PLAN.standard.sessions.filter(function (s) { return s.date > mine.until; });
    return mine.sessions.concat(tail);
  }
  function byIdS(id) {
    var all = sessions();
    for (var i = 0; i < all.length; i++) if (all[i].id === id) return all[i];
    return null;
  }
  // The first change copies the standard plan so it becomes yours to edit.
  function makeMine() {
    if (!mine || mine.reset) {
      mine = { sessions: PLAN.standard.sessions.map(function (s) { return Object.assign({}, s); }),
               until: PLAN.standard.until, updated: '', version: PLAN.standard.version };
    }
  }
  // Keep the standard weeks up to `date` too, before placing something after the end.
  function reach(date) {
    if (date <= mine.until) return;
    var end = addDays(mondayOf(date), 6);
    PLAN.standard.sessions.forEach(function (s) {
      if (s.date > mine.until && s.date <= end) mine.sessions.push(Object.assign({}, s));
    });
    mine.until = end;
  }
  function change(fn) {
    makeMine();
    fn();
    mine.sessions.sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
    mine.updated = new Date().toISOString();
    planStore.set(mine);
    queueSync();
    drawAll();
  }
  function moveSession(id, date) {
    change(function () {
      reach(date);
      mine.sessions.forEach(function (s) { if (s.id === id) s.date = date; });
    });
  }
  function saveSession(obj) {
    change(function () {
      reach(obj.date);
      var found = false;
      mine.sessions.forEach(function (s) { if (s.id === obj.id) { Object.assign(s, obj); found = true; } });
      if (!found) mine.sessions.push(obj);
    });
  }
  function removeSession(id) {
    change(function () { mine.sessions = mine.sessions.filter(function (s) { return s.id !== id; }); });
  }
  function resetPlan() {
    mine = { reset: true, sessions: [], until: '', updated: new Date().toISOString(), version: PLAN.standard.version };
    planStore.set(mine);
    queueSync();
    drawAll();
  }

  var syncTimer = null;
  function status(text) { var el = document.getElementById('planstatus'); if (el) el.textContent = text; }
  function queueSync() {
    status('Saved on this device…');
    clearTimeout(syncTimer);
    syncTimer = setTimeout(sync, 1500);                // one save for a burst of moves
  }
  async function sync() {
    var body = mine && mine.reset ? { sessions: [], until: '', updated: mine.updated, version: mine.version } : mine;
    var res = await putEncrypted('plan.enc', body, 'Save training plan');
    if (!res.ok && res.why === 'conflict') res = await putEncrypted('plan.enc', body, 'Save training plan');
    status(res.ok ? 'Saved and synced.' : WHY[res.why] || 'Saved on this device.');
  }
  // A plan edited on another device since this page was built.
  pullEncrypted('plan.enc').then(function (remote) {
    if (!remote || !remote.updated) return;
    if (!remote.sessions || !remote.sessions.length) remote.reset = true;
    if (!sameVersion(remote)) return;
    var pick = newest(mine, remote);
    if (pick === remote && (!mine || remote.updated !== mine.updated)) {
      mine = remote; planStore.set(mine); drawAll();
    }
  });

  /* ---------------- runs against the plan ----------------
   * A run on a session's own day completes it. Otherwise, within the same
   * week: a threshold run fills the threshold session, the longest run the
   * long one, and any run an easy one. What is left over is an extra run.
   * ------------------------------------------------------- */
  var runsByDay = {};
  runs.forEach(function (r) { (runsByDay[r.dt.slice(0, 10)] = runsByDay[r.dt.slice(0, 10)] || []).push(r); });
  function weekRuns(monday) {
    var out = [];
    for (var i = 0; i < 7; i++) out = out.concat(runsByDay[addDays(monday, i)] || []);
    return out;
  }
  function weekSessions(monday) {
    var end = addDays(monday, 6);
    return sessions().filter(function (s) { return s.date >= monday && s.date <= end; });
  }
  function matchWeek(monday) {
    var all = weekSessions(monday), left = weekRuns(monday).slice(), done = {};
    var sess = all.filter(function (s) { return !s.opt; }).concat(all.filter(function (s) { return s.opt; }));
    var take = function (r) { left = left.filter(function (x) { return x !== r; }); return r; };
    sess.forEach(function (s) {
      var same = left.filter(function (r) { return r.dt.slice(0, 10) === s.date; });
      if (!same.length) return;
      var best = same.filter(function (r) { return r.k === s.type; })[0] || same[0];
      done[s.id] = take(best);
    });
    sess.forEach(function (s) {
      if (done[s.id] || s.date > TODAY || !left.length) return;
      var pick = null;
      if (s.type === 'threshold') pick = left.filter(function (r) { return r.k === 'threshold'; })[0];
      else if (s.type === 'long') pick = left.slice().sort(function (a, b) { return b.s - a.s; })[0];
      else if (s.type === 'easy') pick = left.filter(function (r) { return r.k !== 'threshold'; })[0];
      if (pick) done[s.id] = take(pick);
    });
    var required = all.filter(function (s) { return !s.opt; });
    return { sessions: all, required: required, done: done, extra: left,
             doneCount: required.filter(function (s) { return done[s.id]; }).length };
  }

  /* ---------------- drawing ---------------- */
  var cal = { view: prefs.get('calview', 'week'), anchor: mondayOf(TODAY) };

  function sessionChip(s, m, compact) {
    var t = TYPES[s.type] || TYPES.other, run = m.done[s.id];
    var state = run ? 'done' : s.date < TODAY && !s.opt ? 'missed' : '';
    var mark = run ? '✓' : state === 'missed' ? '–' : '';
    if (s.opt) state += ' opt';
    if (compact) {
      return '<button type="button" class="sess mini ' + state + '" data-id="' + esc(s.id) + '" style="--zc:var(--z-' + t.zone + ')"' +
        ' title="' + esc(s.title) + '">' + (run ? '✓ ' : '') + t.short + '</button>';
    }
    var sub = run ? 'Done · ' + (run.m / 1000).toFixed(1) + ' km · ' + pace(run.s / (run.m / 1000)) + ' /km'
      : state === 'missed' ? 'Not done' : (s.opt ? 'Optional · ' : '') + targetFor(s.type);
    return '<button type="button" class="sess ' + state + '" data-id="' + esc(s.id) + '" style="--zc:var(--z-' + t.zone + ')">' +
      '<span class="s-mark">' + mark + '</span><span class="s-main"><b>' + esc(s.title || t.name) + '</b>' +
      (sub ? '<small>' + esc(sub) + '</small>' : '') + '</span></button>';
  }
  function extraChip(r) {
    return '<a class="xrun" href="#/run/' + r.id + '" style="--zc:var(--z-' + (r.z === 'nohr' ? 'nohr' : r.z) + ')">' +
      '<i></i>Extra run · ' + (r.m / 1000).toFixed(1) + ' km</a>';
  }

  function drawWeek(body) {
    var monday = cal.anchor = mondayOf(cal.anchor), m = matchWeek(monday), html = '';
    for (var i = 0; i < 7; i++) {
      var day = addDays(monday, i);
      var list = m.sessions.filter(function (s) { return s.date === day; });
      var extras = m.extra.filter(function (r) { return r.dt.slice(0, 10) === day; });
      html += '<div class="wday' + (day === TODAY ? ' today' : '') + (day < TODAY ? ' past' : '') + '" data-date="' + day + '">' +
        '<div class="wd-label"><b>' + DAYS_SHORT[i] + '</b><span>' + dm(day) + '</span></div>' +
        '<div class="wd-items">' + list.map(function (s) { return sessionChip(s, m, false); }).join('') +
        extras.map(extraChip).join('') +
        (!list.length && !extras.length ? '<span class="rest">Rest</span>' : '') + '</div>' +
        '<button type="button" class="addbtn" data-add="' + day + '" aria-label="Add a session on ' + dayName(day) + '">+</button></div>';
    }
    body.innerHTML = '<div class="wkdays">' + html + '</div>';
    document.getElementById('caltitle').textContent = 'Week ' + isoWeek(monday);
    document.getElementById('calsub').textContent = dm(monday) + '–' + dm(addDays(monday, 6)) +
      (m.required.length ? ' · ' + m.doneCount + ' of ' + m.required.length + ' done' : ' · nothing planned');
  }

  function drawMonth(body) {
    var first = cal.anchor.slice(0, 8) + '01', d = parseYmd(first);
    var start = mondayOf(first), html = '<div class="mgrid">';
    DAYS_SHORT.forEach(function (n) { html += '<span class="mhead">' + n.charAt(0) + '</span>'; });
    for (var w = 0; w < 6; w++) {
      var monday = addDays(start, w * 7);
      if (w > 3 && monday.slice(0, 7) !== first.slice(0, 7)) break;
      var m = matchWeek(monday);
      for (var i = 0; i < 7; i++) {
        var day = addDays(monday, i), inMonth = day.slice(0, 7) === first.slice(0, 7);
        var list = m.sessions.filter(function (s) { return s.date === day; });
        var extras = m.extra.filter(function (r) { return r.dt.slice(0, 10) === day; });
        html += '<div class="mday' + (inMonth ? '' : ' out') + (day === TODAY ? ' today' : '') + '" data-date="' + day + '">' +
          '<span class="mnum">' + parseYmd(day).getDate() + '</span>' +
          list.map(function (s) { return sessionChip(s, m, true); }).join('') +
          (extras.length ? '<a class="xdot" href="#/run/' + extras[0].id + '" aria-label="Extra run">+' +
            (extras[0].m / 1000).toFixed(0) + '</a>' : '') + '</div>';
      }
    }
    body.innerHTML = html + '</div>';
    document.getElementById('caltitle').textContent = MONTHS[d.getMonth()] + ' ' + d.getFullYear();
    var planned = sessions().filter(function (s) { return !s.opt && s.date.slice(0, 7) === first.slice(0, 7); }).length;
    document.getElementById('calsub').textContent = planned + ' sessions planned';
  }

  function drawCalendar() {
    var body = document.getElementById('calbody');
    if (!body) return;
    document.querySelectorAll('#calview button').forEach(function (b) {
      b.classList.toggle('on', b.dataset.view === cal.view);
    });
    body.classList.toggle('month', cal.view === 'month');
    if (cal.view === 'month') drawMonth(body); else drawWeek(body);
    var reset = document.getElementById('planreset');
    if (reset) reset.hidden = !mine || !!mine.reset;
  }

  /* ---------------- Home: the next session and this week ---------------- */
  function drawHome() {
    var host = document.getElementById('homenext'), strip = document.getElementById('homeweek');
    if (!host) return;
    var monday = mondayOf(TODAY), m = matchWeek(monday);
    var open = sessions().filter(function (s) {
      if (s.opt || s.date < TODAY) return false;
      return !(s.date <= addDays(monday, 6) && m.done[s.id]);
    });
    var missed = m.required.filter(function (s) { return s.date < TODAY && !m.done[s.id]; });
    var next = open[0], html;
    if (next) {
      var t = TYPES[next.type] || TYPES.other, today = next.date === TODAY;
      host.style.setProperty('--zc', 'var(--z-' + t.zone + ')');
      var target = targetFor(next.type);
      html = '<div class="nx-top"><span class="typechip"><i></i>' + t.name + '</span>' +
        '<span class="nx-when">' + whenWord(next.date) + ' · ' + dm(next.date) + '</span>' +
        '<span class="pill' + (today ? ' hot' : '') + '">' + (today ? 'Today' : 'Next up') + '</span></div>' +
        '<h3 class="nx-title">' + esc(next.title || t.name) + '</h3>' +
        (target ? '<div class="nx-target"><span class="lab">Heart rate</span><span class="big">' + target + '</span></div>' : '') +
        (next.detail ? '<p class="nx-detail">' + esc(next.detail) + '</p>' : '');
    } else {
      host.style.setProperty('--zc', 'var(--good)');
      html = '<div class="nx-top"><span class="pill ok-pill">All done ✓</span></div>' +
        '<h3 class="nx-title">Nothing more planned</h3><p class="nx-detail">Add sessions in the plan to see them here.</p>';
    }
    if (missed.length) {
      html += '<p class="hint">' + missed.length + ' session' + (missed.length > 1 ? 's' : '') + ' this week not done yet (' +
        missed.map(function (s) { return (TYPES[s.type] || TYPES.other).short.toLowerCase() + ', ' + DAYS_SHORT[weekdayOf(s.date)]; }).join('; ') +
        '). Drag ' + (missed.length > 1 ? 'them' : 'it') + ' to a later day in the plan if you still want to fit ' +
        (missed.length > 1 ? 'them' : 'it') + ' in.</p>';
    }
    html += '<div class="nx-foot"><a class="btn small ghost" href="#/plan">Open the plan</a></div>';
    host.innerHTML = html;

    var cells = '';
    for (var i = 0; i < 7; i++) {
      var day = addDays(monday, i);
      var s = m.sessions.filter(function (x) { return x.date === day && (!x.opt || m.done[x.id]); })[0];
      var ex = m.extra.filter(function (r) { return r.dt.slice(0, 10) === day; })[0];
      var cls = 'day' + (day === TODAY ? ' today' : ''), mark = '·', lab = 'Rest', wide = 'Rest', zc = '';
      if (s && m.done[s.id]) {
        var r = m.done[s.id];
        cls += ' done'; mark = '✓'; lab = (r.m / 1000).toFixed(1); wide = lab + ' km';
        zc = TYPES[s.type].zone;
      } else if (s) {
        cls += ' planned' + (day < TODAY ? ' late' : ''); mark = '';
        lab = TYPES[s.type].short; wide = TYPES[s.type].name; zc = TYPES[s.type].zone;
      } else if (ex) {
        cls += ' done'; mark = '✓'; lab = (ex.m / 1000).toFixed(1); wide = lab + ' km'; zc = ex.z === 'nohr' ? 'nohr' : ex.z;
      } else cls += ' rest';
      cells += '<a class="' + cls + '" href="#/plan"' + (zc ? ' style="--zc:var(--z-' + zc + ')"' : '') + '>' +
        '<span class="dname">' + DAYS_SHORT[i] + '</span><span class="dmark">' + mark + '</span>' +
        '<span class="dlabel">' + lab + '</span><span class="dlabel wide">' + wide + '</span></a>';
    }
    strip.innerHTML = cells;
    document.getElementById('homeweeksub').textContent = 'Week ' + isoWeek(monday) + ' · ' +
      m.doneCount + ' of ' + m.required.length + ' sessions done' +
      (m.extra.length ? ' · ' + m.extra.length + ' extra run' + (m.extra.length > 1 ? 's' : '') : '');
  }

  function drawAll() { drawCalendar(); drawHome(); }

  /* ---------------- one session: look, change, move, remove ---------------- */
  function typeButtons(current) {
    return '<div class="choices wrap" id="ptype" role="group" aria-label="Kind of session">' +
      ['easy', 'long', 'threshold', 'race', 'other'].map(function (k) {
        return '<button type="button" data-type="' + k + '"' + (k === current ? ' class="on"' : '') + '>' + TYPES[k].name + '</button>';
      }).join('') + '</div>';
  }
  function formHTML(s) {
    return '<form class="pform" id="pform">' +
      '<p class="eyebrow">Kind</p>' + typeButtons(s.type) +
      '<label class="pfield"><span class="eyebrow">Title</span><input class="input" id="ptitle" maxlength="120" value="' + esc(s.title) + '"></label>' +
      '<label class="pfield"><span class="eyebrow">Day</span><input class="input" type="date" id="pdate" value="' + s.date + '"></label>' +
      '<label class="pfield"><span class="eyebrow">Notes</span><textarea class="input" id="pdetail" rows="5" maxlength="2000">' +
      esc(s.detail) + '</textarea></label>' +
      '<label class="pcheck"><input type="checkbox" id="popt"' + (s.opt ? ' checked' : '') + '> Optional - fine to skip</label>' +
      '<div class="pbtns"><button type="submit" class="btn">Save</button>' +
      '<button type="button" class="btn ghost" data-close>Cancel</button></div></form>';
  }
  function wireForm(body, s, close, isNew) {
    var type = s.type;
    body.querySelector('#ptype').addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (!b) return;
      var title = body.querySelector('#ptitle');
      if (!title.value || title.value === (TYPES[type] || {}).name) title.value = TYPES[b.dataset.type].name;
      type = b.dataset.type;
      body.querySelectorAll('#ptype button').forEach(function (x) { x.classList.toggle('on', x === b); });
    });
    body.querySelector('[data-close]').addEventListener('click', close);
    body.querySelector('#pform').addEventListener('submit', function (e) {
      e.preventDefault();
      var date = body.querySelector('#pdate').value || s.date;
      var obj = { id: s.id, type: type, date: date,
        title: body.querySelector('#ptitle').value.trim() || TYPES[type].name,
        detail: body.querySelector('#pdetail').value.trim() };
      if (body.querySelector('#popt').checked) obj.opt = true;
      else obj.opt = false;
      saveSession(obj);
      close();
    });
    if (isNew) body.querySelector('#ptitle').select();
  }

  function openSession(id) {
    var s = byIdS(id);
    if (!s) return;
    var t = TYPES[s.type] || TYPES.other, m = matchWeek(mondayOf(s.date)), run = m.done[s.id];
    var week = mondayOf(s.date), moves = '';
    for (var i = 0; i < 7; i++) {
      var day = addDays(week, i);
      moves += '<button type="button" data-move="' + day + '"' + (day === s.date ? ' class="on"' : '') + '>' +
        DAYS_SHORT[i] + '<small>' + parseYmd(day).getDate() + '</small></button>';
    }
    var target = targetFor(s.type);
    openSheet(esc(s.title || t.name),
      '<div class="psess" style="--zc:var(--z-' + t.zone + ')">' +
      '<div class="nx-top"><span class="typechip"><i></i>' + t.name + '</span><span class="nx-when">' +
      dayName(s.date) + ' ' + dm(s.date) + '</span>' +
      (run ? '<span class="pill ok-pill">Done ✓</span>' : s.opt ? '<span class="pill">Optional</span>'
        : s.date < TODAY ? '<span class="pill warn">Not done</span>' : '') + '</div>' +
      (target ? '<div class="nx-target"><span class="lab">Heart rate</span><span class="big">' + target + '</span></div>' : '') +
      (s.detail ? '<p class="nx-detail">' + esc(s.detail) + '</p>' : '') +
      (run ? '<a class="xrun big" href="#/run/' + run.id + '" style="--zc:var(--z-' + (run.z === 'nohr' ? 'nohr' : run.z) + ')"><i></i>' +
        esc(run.n) + ' · ' + (run.m / 1000).toFixed(1) + ' km · ' + hms(run.s) + ' →</a>' : '') +
      '<p class="eyebrow" style="margin-top:18px">Move to</p><div class="movedays">' + moves + '</div>' +
      '<div class="pbtns"><button type="button" class="btn ghost" data-edit>Change</button>' +
      '<button type="button" class="btn danger" data-remove>Remove</button></div>' +
      '<p class="hint" id="pconfirm" hidden></p></div>',
      function (body, close) {
        body.addEventListener('click', function (e) {
          var mv = e.target.closest('[data-move]');
          if (mv) { if (mv.dataset.move !== s.date) moveSession(s.id, mv.dataset.move); close(); return; }
          if (e.target.closest('[data-edit]')) {
            body.innerHTML = formHTML(s);
            wireForm(body, s, close, false);
            return;
          }
          var rm = e.target.closest('[data-remove]');
          if (rm) {
            if (rm.dataset.sure) { removeSession(s.id); close(); return; }
            rm.dataset.sure = '1'; rm.textContent = 'Tap again to remove';
          }
          if (e.target.closest('a[href^="#/run/"]')) close();
        });
      });
  }

  function openNew(date) {
    var s = { id: 'u-' + Date.now().toString(36), type: 'easy', date: date, title: TYPES.easy.name, detail: '' };
    openSheet('New session · ' + dayName(date) + ' ' + dm(date), formHTML(s), function (body, close) {
      wireForm(body, s, close, true);
    });
  }

  /* ---------------- dragging a session to another day ----------------
   * On a phone: hold for a moment, then drag - a quick swipe still scrolls
   * the page. With a mouse: just drag. Drop on any day, in either view.
   * ------------------------------------------------------------------- */
  var drag = null;
  function dayAt(x, y) {
    var el = document.elementFromPoint(x, y);
    return el && el.closest ? el.closest('#calbody [data-date]') : null;
  }
  function startDrag(p) {
    var chip = p.chip, r = chip.getBoundingClientRect();
    var ghost = chip.cloneNode(true);
    ghost.classList.add('ghost');
    ghost.style.width = r.width + 'px';
    document.body.appendChild(ghost);
    drag = Object.assign(p, { ghost: ghost, dx: p.x - r.left, dy: p.y - r.top, over: null });
    chip.classList.add('lifted');
    document.body.classList.add('dragging');
    if (navigator.vibrate) { try { navigator.vibrate(12); } catch (e) {} }
    moveDrag(p.x, p.y);
  }
  function moveDrag(x, y) {
    drag.ghost.style.transform = 'translate(' + (x - drag.dx) + 'px,' + (y - drag.dy) + 'px)';
    var over = dayAt(x, y);
    if (over !== drag.over) {
      if (drag.over) drag.over.classList.remove('dropping');
      if (over) over.classList.add('dropping');
      drag.over = over;
    }
    // near the top or bottom of the screen, scroll to reach more days
    var edge = 70, h = window.innerHeight;
    drag.scroll = y < edge ? -8 : y > h - edge - 70 ? 8 : 0;
  }
  function endDrag(drop) {
    var d = drag; drag = null;
    if (!d) return;
    d.ghost.remove();
    d.chip.classList.remove('lifted');
    document.body.classList.remove('dragging');
    if (d.over) d.over.classList.remove('dropping');
    if (drop && d.over && d.over.dataset.date !== byIdS(d.id).date) moveSession(d.id, d.over.dataset.date);
  }
  (function autoScroll() {
    if (drag && drag.scroll) { window.scrollBy(0, drag.scroll); moveDrag(drag.lx, drag.ly); }
    requestAnimationFrame(autoScroll);
  })();

  var press = null;
  document.addEventListener('pointerdown', function (e) {
    var chip = e.target.closest && e.target.closest('#calbody .sess');
    if (!chip || e.button > 0) return;
    press = { chip: chip, id: chip.dataset.id, x: e.clientX, y: e.clientY, lx: e.clientX, ly: e.clientY,
              touch: e.pointerType !== 'mouse', moved: false };
    if (press.touch) press.timer = setTimeout(function () { if (press && !press.moved) startDrag(press); }, 260);
  });
  document.addEventListener('pointermove', function (e) {
    if (!press) return;
    press.lx = e.clientX; press.ly = e.clientY;
    if (drag) { moveDrag(e.clientX, e.clientY); return; }
    var far = Math.abs(e.clientX - press.x) + Math.abs(e.clientY - press.y) > 8;
    if (!far) return;
    press.moved = true;
    if (press.touch) { clearTimeout(press.timer); press = null; }   // a swipe: let the page scroll
    else startDrag(press);
  });
  document.addEventListener('pointerup', function () {
    if (!press) return;
    clearTimeout(press.timer);
    var wasDrag = !!drag, p = press;
    press = null;
    if (wasDrag) { endDrag(true); p.dragged = true; lastDrag = Date.now(); }
  });
  document.addEventListener('pointercancel', function () {
    if (press) clearTimeout(press.timer);
    press = null; endDrag(false);
  });
  // once a drag has started, the page must not scroll under the finger
  document.addEventListener('touchmove', function (e) { if (drag) e.preventDefault(); }, { passive: false });
  document.addEventListener('contextmenu', function (e) { if (e.target.closest && e.target.closest('#calbody .sess')) e.preventDefault(); });
  var lastDrag = 0;

  /* ---------------- the calendar's own buttons ---------------- */
  (function wirePlan() {
    var cardEl = document.getElementById('calbody');
    if (!cardEl) return;
    var root = cardEl.closest('.card');
    root.addEventListener('click', function (e) {
      if (Date.now() - lastDrag < 120) return;           // the click that ends a drag is not a tap
      if (e.target.closest('a')) return;                 // links go where they point
      var b = e.target.closest('button, .mday');
      if (!b) return;
      if (b.dataset.view) { cal.view = b.dataset.view; prefs.set('calview', cal.view); drawCalendar(); return; }
      var act = b.dataset.cal;
      if (act === 'today') { cal.anchor = mondayOf(TODAY); drawCalendar(); return; }
      if (act === 'prev' || act === 'next') {
        var dir = act === 'next' ? 1 : -1;
        if (cal.view === 'month') {
          var d = parseYmd(cal.anchor.slice(0, 8) + '01');
          d.setMonth(d.getMonth() + dir);
          cal.anchor = ymd(d);
        } else cal.anchor = addDays(cal.anchor, 7 * dir);
        drawCalendar(); return;
      }
      if (b.dataset.add) { openNew(b.dataset.add); return; }
      if (b.classList.contains('sess')) { openSession(b.dataset.id); return; }
      if (b.classList.contains('mday')) {                // a day in the month: open its week
        cal.view = 'week'; prefs.set('calview', 'week'); cal.anchor = mondayOf(b.dataset.date); drawCalendar();
      }
    });
    var reset = document.getElementById('planreset');
    reset.addEventListener('click', function () {
      if (!reset.dataset.sure) {
        reset.dataset.sure = '1';
        reset.textContent = 'Tap again: undo all your changes to the plan';
        setTimeout(function () { delete reset.dataset.sure; reset.textContent = 'Back to the standard plan'; }, 4000);
        return;
      }
      delete reset.dataset.sure;
      reset.textContent = 'Back to the standard plan';
      resetPlan();
    });
    if (cal.view === 'month') cal.anchor = TODAY;
  })();

  window.planPage = { refresh: drawAll };
  drawAll();
