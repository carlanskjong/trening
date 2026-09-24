  /* ================================================================
   * Progress charts, drawn from window.PROG (see progress_payload() in
   * report.py). Each sits in an empty `.pc` box the page leaves for it.
   * Hover (or a tap in the window) reads a point; a tap opens the chart full
   * screen, where it zooms.
   * ================================================================ */
  var PROG = window.PROG || {};
  var DAY = 86400000;
  function dayNum(iso) { return Math.round(Date.parse(iso + 'T12:00:00Z') / DAY); }
  function dayLabel(n) {
    var d = new Date(n * DAY);
    return ('0' + d.getUTCDate()).slice(-2) + '.' + ('0' + (d.getUTCMonth() + 1)).slice(-2);
  }
  // Date ticks on Mondays for weekly steps (day 4 after 1.1.1970 was a Monday).
  function dayTicks(lo, hi, count) {
    var steps = [1, 2, 7, 14, 28, 56, 112, 224], span = hi - lo, step = steps[steps.length - 1];
    for (var i = 0; i < steps.length; i++) if (span / steps[i] <= count + 1) { step = steps[i]; break; }
    var base = step >= 7 ? 4 : 0, out = [];
    for (var v = Math.ceil((lo - base) / step) * step + base; v <= hi; v += step) out.push(v);
    out.step = step;
    return out;
  }
  var roomy = function (small, big) { return function (w) { return w > 600 ? big : small; }; };

  // One column per week; the current week is the accent.
  function colsSpec(data, label, fmt) {
    var n = data.weeks.length;
    var items = data.v.map(function (v, i) {
      return { x: i, v: v, band: data.band ? data.band[i] : null, cls: i === n - 1 ? 'now' : '' };
    });
    var top = function (a, b) {
      var m = 1;
      items.forEach(function (c) {
        if (c.x < a - 0.5 || c.x > b + 0.5) return;
        m = Math.max(m, c.v || 0, c.band ? c.band[1] : 0);
      });
      return [0, m * 1.12];
    };
    return {
      label: label, h: roomy(210, 250), zoom: 'x', nearBy: 'x', left: 40,
      x: { lo: -0.6, hi: n - 0.4, minSpan: 3,
           ticks: function (a, b, count) {
             var k = Math.max(1, Math.ceil((b - a) / count)), out = [];
             for (var i = n - 1; i >= 0; i -= k) if (i >= a && i <= b) out.unshift(i);
             return out;
           },
           fmt: function (i) { return dayLabel(dayNum(data.weeks[i])); } },
      y: { lo: 0, hi: top(-1, n)[1], fit: top, fmt: fmt || function (v) { return Math.round(v); } },
      layers: [{ type: 'cols', items: items }],
      tips: items.map(function (c, i) { return { x: c.x, y: c.v, html: data.tips[i] }; })
    };
  }

  // Dots over time with a rolling average through them.
  function trendSpec(points, label, fmt, opts) {
    opts = opts || {};
    if (points.length < 3) return null;
    var xs = points.map(function (p) { return dayNum(p[0]); }), ys = points.map(function (p) { return p[1]; });
    var roll = ys.map(function (_, i) {
      var w = ys.slice(Math.max(0, i - 2), i + 3);
      return w.reduce(function (a, b) { return a + b; }, 0) / w.length;
    });
    var fit = function (a, b) {
      var v = [];
      for (var i = 0; i < ys.length; i++) if (xs[i] >= a && xs[i] <= b) v.push(ys[i]);
      if (v.length < 2) return null;
      var lo = Math.min.apply(null, v), hi = Math.max.apply(null, v), span = Math.max(hi - lo, Math.abs(hi) * 0.03, 1e-6);
      if (opts.keep) { lo = Math.min(lo, opts.keep[0]); hi = Math.max(hi, opts.keep[1]); span = hi - lo; }
      return [lo - span * 0.15, hi + span * 0.15];
    };
    var x0 = xs[0] - 4, x1 = xs[xs.length - 1] + 4, full = fit(x0, x1);
    return {
      label: label, h: roomy(200, 240), zoom: 'x', left: 44,
      x: { lo: x0, hi: x1, minSpan: 14, ticks: dayTicks, fmt: dayLabel },
      y: { lo: full[0], hi: full[1], fit: fit, invert: !!opts.invert, fmt: fmt, steps: opts.steps },
      layers: [
        { type: 'line', xs: xs, ys: roll, cls: 'trend' },
        { type: 'dots', r: 4, pts: points.map(function (p, i) {
          return { x: xs[i], y: ys[i], fill: opts.colour ? opts.colour(ys[i]) : null };
        }) }
      ],
      tips: points.map(function (p, i) { return { x: xs[i], y: ys[i], html: p[2] }; })
    };
  }

  // Each run as a dot: heart rate across, pace up (faster higher).
  function scatterSpec(points) {
    if (points.length < 4) return null;
    var hrs = points.map(function (p) { return p[0]; }), pcs = points.map(function (p) { return p[1]; });
    var x0 = Math.min.apply(null, hrs) - 4, x1 = Math.max.apply(null, hrs) + 4;
    var lo = Math.min.apply(null, pcs), hi = Math.max.apply(null, pcs), pad = Math.max((hi - lo) * 0.12, 5);
    var ordered = points.filter(function (p) { return !p[3]; }).concat(points.filter(function (p) { return p[3]; }));
    return {
      label: 'Pace against heart rate', h: roomy(270, 320), zoom: 'xy', left: 46,
      x: { lo: x0, hi: x1, minSpan: 6, fmt: function (v) { return Math.round(v) + ''; }, steps: [2, 5, 10, 20] },
      y: { lo: lo - pad, hi: hi + pad, minSpan: 10, invert: true, fmt: pace, steps: [5, 10, 15, 20, 30, 60] },
      layers: [
        { type: 'vbands', bands: conf.zones.map(function (z) {
          return { lo: conf.maxhr * z[2] / 100, hi: conf.maxhr * z[3] / 100, key: z[0], label: z[1] };
        }) },
        { type: 'dots', r: 4.5, pts: ordered.map(function (p) { return { x: p[0], y: p[1], cls: p[3] ? 'recent' : '' }; }) }
      ],
      tips: points.map(function (p) { return { x: p[0], y: p[1], html: p[2] }; })
    };
  }

  // Fitness (6-week load), fatigue (1-week) and form (the difference).
  function fitSpec(rows) {
    if (!rows || rows.length < 21) return null;
    var xs = rows.map(function (r) { return dayNum(r[0]); });
    var get = function (k) { return rows.map(function (r) { return r[k]; }); };
    var fit = get(1), fat = get(2), form = get(3);
    var all = fit.concat(fat, form), lo = Math.min.apply(null, all), hi = Math.max.apply(null, all);
    var fitY = function (a, b) {
      var v = [];
      for (var i = 0; i < xs.length; i++) if (xs[i] >= a && xs[i] <= b) v.push(fit[i], fat[i], form[i]);
      if (!v.length) return null;
      var l = Math.min(0, Math.min.apply(null, v)), h = Math.max.apply(null, v);
      return [l - (h - l) * 0.06, h + (h - l) * 0.08];
    };
    return {
      label: 'Fitness and form', h: roomy(230, 270), zoom: 'x', nearBy: 'x', left: 40,
      x: { lo: xs[0], hi: xs[xs.length - 1], minSpan: 21, ticks: dayTicks, fmt: dayLabel },
      y: { lo: Math.min(0, lo), hi: hi, fit: fitY, fmt: function (v) { return Math.round(v); } },
      layers: [
        { type: 'guide', y: 0, text: '' },
        { type: 'line', xs: xs, ys: fit, cls: 'fit', area: true },
        { type: 'line', xs: xs, ys: fat, cls: 'fat' },
        { type: 'line', xs: xs, ys: form, cls: 'form' }
      ],
      tips: rows.map(function (r, i) {
        var f = r[3], word = f > 5 ? 'fresh' : f < -20 ? 'very tired' : f < -8 ? 'tired - building' : 'balanced';
        return { x: xs[i], y: fit[i], html: dayLabel(xs[i]) + '|Fitness ' + Math.round(r[1]) + ' · fatigue ' +
          Math.round(r[2]) + '|Form ' + (f > 0 ? '+' : '') + Math.round(f) + ' - ' + word };
      })
    };
  }

  // Running kilometres through each year, this year in the accent.
  var MONTH_START = [1, 32, 60, 91, 121, 152, 182, 213, 244, 274, 305, 335];
  function ytdSpec(years) {
    var keys = Object.keys(years || {}).sort();
    if (!keys.length) return null;
    var now = keys[keys.length - 1], top = 1;
    keys.forEach(function (y) { years[y].forEach(function (p) { top = Math.max(top, p[1]); }); });
    var cls = function (y) { return y === now ? 'yr0' : y === keys[keys.length - 2] ? 'yr1' : 'yr2'; };
    var weeks = years[now].map(function (p) { return p[0]; });
    return {
      label: 'Distance through the year', h: roomy(230, 270), zoom: 'x', nearBy: 'x', left: 44,
      x: { lo: 0, hi: 366, minSpan: 28,
           ticks: function (a, b, count) {
             var k = Math.max(1, Math.ceil(12 / Math.max(count, 1))), out = [];
             MONTH_START.forEach(function (d, i) { if (i % k === 0 && d >= a && d <= b) out.push(d); });
             return out;
           },
           fmt: function (d) { return MONTHS[MONTH_START.indexOf(d)].slice(0, 3); } },
      y: { lo: 0, hi: top * 1.08, fmt: function (v) { return Math.round(v); } },
      layers: keys.map(function (y) {
        return { type: 'line', xs: years[y].map(function (p) { return p[0]; }), ys: years[y].map(function (p) { return p[1]; }),
                 cls: cls(y) };
      }),
      tips: weeks.map(function (d, i) {
        var lines = keys.slice().reverse().map(function (y) {
          var p = years[y].filter(function (q) { return q[0] <= d; }).pop();
          return p ? y + ': ' + Math.round(p[1]) + ' km' : null;
        }).filter(Boolean);
        return { x: d, y: years[now][i][1], html: 'Day ' + d + ' of the year|' + lines.join('|') };
      }),
      legend: keys.slice().reverse().map(function (y) {
        return '<span><i class="lf ' + cls(y) + '"></i>' + y + '</span>';
      }).join('')
    };
  }

  // His own 1-10 ratings from the run pages, coloured by the kind of session.
  function rpeSpec() {
    var pts = [];
    acts.forEach(function (a) {
      var n = NOTES[a.id];
      if (n && +n.rpe >= 1 && +n.rpe <= 10) pts.push(a);
    });
    if (pts.length < 2) return null;
    pts.sort(function (a, b) { return a.dt < b.dt ? -1 : 1; });
    var xs = pts.map(function (a) { return dayNum(a.dt.slice(0, 10)); });
    return {
      label: 'How hard it felt', h: roomy(200, 230), zoom: 'x', left: 32,
      x: { lo: xs[0] - 4, hi: xs[xs.length - 1] + 4, minSpan: 14, ticks: dayTicks, fmt: dayLabel },
      y: { lo: 0.5, hi: 10.5, fmt: function (v) { return v; }, ticks: function () { return [2, 4, 6, 8, 10]; } },
      layers: [{ type: 'hbands', bands: [{ lo: 6, hi: 7.5, key: 'threshold', label: 'Threshold feel' },
                                         { lo: 1.5, hi: 4.5, key: 'easy', label: 'Easy feel' }] },
               { type: 'dots', r: 5, pts: pts.map(function (a, i) { return { x: xs[i], y: +NOTES[a.id].rpe, fill: kindColour(a) }; }) }],
      tips: pts.map(function (a, i) {
        return { x: xs[i], y: +NOTES[a.id].rpe, html: esc(a.n) + '|' + dayLabel(xs[i]) + ' · felt ' + NOTES[a.id].rpe + '/10' +
          (a.hr ? '|' + a.hr + ' bpm average' : '') };
      })
    };
  }

  /* ---------------- the training log, Strava style ---------------- */
  var logWeeks = 12;
  function drawLog() {
    var host = document.getElementById('traininglog');
    if (!host) return;
    var byDay = {};
    acts.forEach(function (a) { (byDay[a.dt.slice(0, 10)] = byDay[a.dt.slice(0, 10)] || []).push(a); });
    var first = acts.length ? mondayOf(acts[acts.length - 1].dt.slice(0, 10)) : TODAY;
    var monday = mondayOf(TODAY), html = '<div class="tl-row tl-head"><span></span>' +
      DAYS_SHORT.map(function (d) { return '<span>' + d.charAt(0) + '</span>'; }).join('') + '<span>Week</span></div>';
    for (var w = 0; w < logWeeks && monday >= first; w++, monday = addDays(monday, -7)) {
      var km = 0, secs = 0, cells = '';
      for (var i = 0; i < 7; i++) {
        var day = addDays(monday, i), list = (byDay[day] || []).slice().sort(function (a, b) { return b.s - a.s; });
        var total = list.reduce(function (t, a) { return t + a.s; }, 0);
        list.forEach(function (a) { secs += a.s; if (isRun(a)) km += a.m / 1000; });
        if (!list.length) { cells += '<span class="tl-day' + (day === TODAY ? ' today' : '') + '"><i class="tl-none"></i></span>'; continue; }
        var size = Math.round(10 + 26 * Math.min(1, Math.sqrt(total / 7200)));
        var main = list[0], tip = list.map(function (a) { return kindName(a) + ' ' + hms(a.s); }).join(' + ');
        cells += '<span class="tl-day' + (day === TODAY ? ' today' : '') + '"><a href="#/run/' + main.id + '" title="' + esc(tip) +
          '" aria-label="' + esc(dayLabel(dayNum(day)) + ': ' + tip) + '" style="width:' + size + 'px;height:' + size +
          'px;background:' + kindColour(main) + '">' + (list.length > 1 ? '<b>' + list.length + '</b>' : '') + '</a></span>';
      }
      html += '<div class="tl-row' + (w === 0 ? ' now' : '') + '"><span class="tl-date">' + dayLabel(dayNum(monday)) + '</span>' + cells +
        '<span class="tl-sum"><b>' + km.toFixed(km >= 100 ? 0 : 1) + '</b> km<small>' +
        (secs >= 3600 ? Math.floor(secs / 3600) + 'h ' + pad(Math.floor(secs % 3600 / 60)) + 'm' : Math.round(secs / 60) + ' min') +
        '</small></span></div>';
    }
    var more = monday >= first;
    host.innerHTML = html + (more ? '<button type="button" class="btn small ghost tl-more">Show 12 more weeks</button>' : '') +
      '<div class="flegend"><span><i class="lf" style="background:var(--z-easy)"></i>Easy & long</span>' +
      '<span><i class="lf" style="background:var(--z-threshold)"></i>Threshold</span>' +
      '<span><i class="lf" style="background:var(--bar)"></i>Other sports</span></div>';
    var btn = host.querySelector('.tl-more');
    if (btn) btn.addEventListener('click', function () { logWeeks += 12; drawLog(); });
  }

  var PROG_SPECS = {
    fit: function () { return fitSpec(PROG.fit); },
    ytd: function () { return ytdSpec(PROG.ytd); },
    rpe: rpeSpec,
    load: function () { return PROG.load && colsSpec(PROG.load, 'Weekly training load'); },
    dist: function () { return PROG.dist && colsSpec(PROG.dist, 'Weekly distance (km)'); },
    shr: function () { return scatterSpec(PROG.shr || []); },
    eff: function () { return trendSpec(PROG.eff || [], 'Metres per heartbeat', function (v) { return v.toFixed(2); }); },
    reps: function () {
      return trendSpec(PROG.reps || [], 'Threshold rep pace', pace, { invert: true, steps: [2, 5, 10, 15, 30, 60] });
    },
    cad: function () {
      return trendSpec(PROG.cad || [], 'Cadence per run', function (v) { return Math.round(v); },
        { colour: cadColour, steps: [1, 2, 5, 10], keep: [CAD_LOW - 2, CAD_GOOD + 2] });
    }
  };

  // Ring the point being read and show its tooltip.
  function readPoint(p, px, py, cx, cy, touch) {
    var t = p.nearest(px, py), g = p.g;
    if (!t) { p.mark(''); tipAt(null); return; }
    if (p.spec.nearBy === 'x') {
      var slot = g.pw / (g.x1 - g.x0), x = g.sx(t.x) - slot / 2;
      p.mark('<rect x="' + x.toFixed(1) + '" y="' + g.T + '" width="' + slot.toFixed(1) + '" height="' + g.ph +
        '" class="hlc"/>');
    } else {
      p.mark('<circle cx="' + g.sx(t.x).toFixed(1) + '" cy="' + g.sy(t.y).toFixed(1) + '" r="' + (p.big ? 9 : 8) +
        '" class="hl"/>');
    }
    tipAt(t.html, cx, cy, touch);
  }

  function openProgressChart(key, box) {
    var card = box.closest('.card'), head = card && card.querySelector('h2');
    var hints = card ? Array.prototype.map.call(card.querySelectorAll('.hint'), function (h) { return h.outerHTML; }) : [];
    openChartWindow(head ? esc(head.textContent) : 'Chart', function (stack, read, foot) {
      stack.innerHTML = '<div class="cv"></div>';
      var p = new Plot(stack.querySelector('.cv'), PROG_SPECS[key]());
      foot.innerHTML = hints.join('');
      read.textContent = TOUCH ? 'Touch a point to read it.' : 'Hover a point to read it.';
      return {
        plots: [p], maxH: 560,
        probe: function (q, px, py, cx, cy, touch) { readPoint(q, px, py, cx, cy, touch); },
        leave: function () { p.mark(''); tipAt(null); }
      };
    });
  }

  function drawProgress() {
    document.querySelectorAll('.pc[data-chart]').forEach(function (box) {
      if (box.dataset.drawn) return;
      var key = box.dataset.chart, spec = PROG_SPECS[key] && PROG_SPECS[key]();
      box.dataset.drawn = '1';
      if (!spec) {
        var empty = box.nextElementSibling;
        if (empty && empty.classList.contains('pc-empty')) empty.hidden = false;
        return;
      }
      box.innerHTML = '<div class="cv"></div><div class="cgrab" role="button" tabindex="0" aria-label="Open ' +
        esc(spec.label) + ' full screen"></div>';
      var p = new Plot(box.querySelector('.cv'), spec), grab = box.querySelector('.cgrab');
      if (spec.legend && key === 'ytd') document.getElementById('ytdlegend').innerHTML = spec.legend;
      watchSize(p);
      p.draw();
      hands(grab, [p], {
        touchRead: false,
        probe: readPoint,
        leave: function () { p.mark(''); tipAt(null); },
        tap: function () { tipAt(null); openProgressChart(key, box); }
      });
      grab.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openProgressChart(key, box); }
      });
    });
  }
  drawProgress();
  drawLog();
