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

  var PROG_SPECS = {
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
