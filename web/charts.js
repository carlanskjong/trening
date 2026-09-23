  // ---------- charts ----------
  var W = 760;
  function smooth(values) {
    return values.map(function (v, i) {
      if (v == null) return null;
      var a = values[i - 1] == null ? v : values[i - 1], b = values[i + 1] == null ? v : values[i + 1];
      return (a + v + b) / 3;
    });
  }
  function percentile(values, p) {
    var v = values.filter(function (x) { return x != null; }).sort(function (a, b) { return a - b; });
    if (!v.length) return null;
    return v[Math.min(v.length - 1, Math.max(0, Math.round((v.length - 1) * p)))];
  }

  /*
   * One chart. `invert` puts small values at the top, which is what pace wants:
   * a peak then means fast and a valley means slow, the way it reads on a watch.
   */
  function chart(ys, opts) {
    var H = opts.height, top = 10, bottom = 18, left = 66;
    var plotH = H - top - bottom, plotW = W - left - 8;
    var clean = ys.filter(function (v) { return v != null; });
    if (clean.length < 2) return '';
    var lo = opts.lo != null ? opts.lo : Math.min.apply(null, clean);
    var hi = opts.hi != null ? opts.hi : Math.max.apply(null, clean);
    if (hi - lo < 1e-6) hi = lo + 1;
    var span = (hi - lo) * 1.12, mid = (hi + lo) / 2;
    lo = mid - span / 2; hi = mid + span / 2;
    var x = function (i) { return left + plotW * i / Math.max(ys.length - 1, 1); };
    var y = function (v) {
      var f = (v - lo) / (hi - lo);
      return opts.invert ? top + f * plotH : top + plotH - f * plotH;
    };
    var out = [];
    (opts.bands || []).forEach(function (b) {
      var a = y(Math.min(b.hi, hi)), c = y(Math.max(b.lo, lo));
      var y0 = Math.min(a, c), y1 = Math.max(a, c);
      if (y1 - y0 > 1) out.push('<rect x="' + left + '" y="' + y0.toFixed(1) + '" width="' + plotW +
        '" height="' + (y1 - y0).toFixed(1) + '" class="band ' + b.cls + '"/>');
    });
    for (var t = 0; t < 3; t++) {
      var v = lo + (hi - lo) * (t + 0.5) / 3;
      out.push('<line x1="' + left + '" x2="' + (W - 8) + '" y1="' + y(v).toFixed(1) + '" y2="' +
        y(v).toFixed(1) + '" class="grid"/><text x="' + (left - 6) + '" y="' + (y(v) + 4).toFixed(1) +
        '" class="tick" text-anchor="end">' + opts.fmt(v) + '</text>');
    }
    var d = '', started = false;
    for (var i = 0; i < ys.length; i++) {
      if (ys[i] == null) { started = false; continue; }
      var val = Math.max(lo, Math.min(hi, ys[i]));
      d += (started ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(val).toFixed(1) + ' ';
      started = true;
    }
    if (opts.area) {
      out.push('<path d="' + d + 'L' + x(ys.length - 1).toFixed(1) + ' ' + (top + plotH) + ' L' +
        x(0).toFixed(1) + ' ' + (top + plotH) + ' Z" class="areafill ' + (opts.cls || '') + '"/>');
    }
    out.push('<path d="' + d + '" class="cline ' + (opts.cls || '') + '"/>');
    out.push('<line class="cursor" x1="0" x2="0" y1="' + top + '" y2="' + (top + plotH) + '"/>');
    return '<div class="chartbox" data-kind="' + (opts.kind || '') + '">' +
      '<span class="clabel">' + opts.label + (opts.hint ? ' <i>' + opts.hint + '</i>' : '') + '</span>' +
      '<svg viewBox="0 0 ' + W + ' ' + H + '" class="cchart" data-left="' + left +
      '" data-right="' + (left + plotW) + '" role="img" aria-label="' + opts.label + '">' +
      out.join('') + '</svg></div>';
  }

  // The three series of a run, optionally only the slice [i0, i1) of it.
  function seriesFor(run, i0, i1) {
    var slice = function (a) { return (a || []).slice(i0, i1); };
    var pc = slice(run.sp).map(function (v) { return v && v > 40 ? 100000 / v : null; });
    return { hr: slice(run.hs), pace: smooth(pc), alt: slice(run.al), dist: slice(run.d), time: slice(run.t),
             cad: smooth(slice(run.cd).map(function (v) { return v > 60 ? v : null; })) };
  }

  function chartsHTML(run, i0, i1, big) {
    var s = seriesFor(run, i0, i1);
    var bands = conf.zones.map(function (z) {
      return { lo: conf.maxhr * z[2] / 100, hi: conf.maxhr * z[3] / 100, cls: 'z' + z[0] };
    });
    var html = chart(s.hr, {
      height: big ? 260 : 150, label: 'Heart rate (bpm)', cls: 'hr', kind: 'hr',
      bands: bands, fmt: function (v) { return Math.round(v); }
    });
    if (s.pace.filter(function (v) { return v; }).length > 5) {
      html += chart(s.pace, {
        height: big ? 220 : 120, label: 'Pace (min/km)', hint: 'higher = faster', cls: 'pace',
        kind: 'pace', fmt: pace, invert: true,
        lo: percentile(s.pace, 0.02), hi: percentile(s.pace, 0.96)
      });
    }
    if (s.cad.filter(function (v) { return v; }).length > 5) {
      html += chart(s.cad, {
        height: big ? 170 : 90, label: 'Cadence (steps/min)', cls: 'cad', kind: 'cad',
        lo: percentile(s.cad, 0.03), hi: percentile(s.cad, 0.97),
        fmt: function (v) { return Math.round(v); }
      });
    }
    if (s.alt.length) {
      html += chart(s.alt, {
        height: big ? 170 : 90, label: 'Elevation (m)', cls: 'elev', kind: 'elev', area: true,
        fmt: function (v) { return Math.round(v) + ' m'; }
      });
    }
    return html;
  }

  /*
   * The moving readout shared by every chart in a box.
   *
   * Attached ONCE per box. The charts inside are rebuilt on every zoom step, so
   * the SVG elements are looked up at the moment a finger moves and never
   * cached - a cached list would point at charts already thrown away, and
   * re-attaching on each redraw would pile up a fresh set of listeners.
   *
   * `surface` is the element that hears the events. In the pop-out that is a
   * transparent sheet which is never rebuilt, so a pinch is not cut short when
   * the chart under the fingers is replaced mid-gesture.
   */
  function attachProbe(surface, box, readout, run, onIndex) {
    function at(clientX) {
      var charts = box.querySelectorAll('.cchart');
      if (!charts.length) return;
      var n = +box.dataset.count, i0 = +box.dataset.from || 0;
      var first = charts[0], rect = first.getBoundingClientRect();
      var left = +first.dataset.left, right = +first.dataset.right;
      var f = (clientX - rect.left) / rect.width * W;
      f = (f - left) / (right - left);
      var i = Math.max(0, Math.min(n - 1, Math.round(f * (n - 1))));
      for (var c = 0; c < charts.length; c++) {
        var cur = charts[c].querySelector('.cursor');
        var px = left + (right - left) * i / Math.max(n - 1, 1);
        cur.setAttribute('x1', px); cur.setAttribute('x2', px);
        cur.style.opacity = 1;
      }
      var j = i0 + i;
      readout.textContent = readoutAt(run, j);
      if (onIndex) onIndex(j);
    }
    function clear() {
      readout.textContent = readout.dataset.idle;
      if (onIndex) onIndex(null);
      var charts = box.querySelectorAll('.cchart');
      for (var c = 0; c < charts.length; c++) charts[c].querySelector('.cursor').style.opacity = 0;
    }
    surface.addEventListener('mousemove', function (e) { at(e.clientX); });
    surface.addEventListener('mouseleave', clear);
    // One finger reads the charts. Two fingers are a pinch, and the readout has
    // to keep its hands off it.
    surface.addEventListener('touchstart', function (e) {
      if (e.touches.length === 1) at(e.touches[0].clientX); else clear();
    }, { passive: true });
    surface.addEventListener('touchmove', function (e) {
      if (e.touches.length === 1) at(e.touches[0].clientX);
    }, { passive: true });
  }

  // Charts blown up, with a zoom window over the run you can widen or narrow.
  function openCharts(run) {
    var n = (run.hs || []).length;
    if (!n) return;
    var view = { i0: 0, i1: n };
    openSheet(esc(run.n), '<div class="zoombar">' +
      '<button type="button" data-act="in">Zoom in</button>' +
      '<button type="button" data-act="out">Zoom out</button>' +
      '<button type="button" data-act="left">◀</button>' +
      '<button type="button" data-act="right">▶</button>' +
      '<button type="button" data-act="reset">Whole run</button></div>' +
      '<p class="hint" id="zoomrange"></p>' +
      '<p class="readout" id="zoomout"></p>' +
      '<div class="charts zoomwrap" id="zoomcharts"><div class="chartsin"></div>' +
      '<div class="chartgrab"></div></div>',
    function (body) {
      var box = body.querySelector('#zoomcharts'), out = body.querySelector('#zoomout');
      // The charts are redrawn inside `pane`; `grab` lies on top and is never
      // rebuilt, so it keeps hearing the fingers all through a pinch.
      var pane = box.querySelector('.chartsin'), grab = box.querySelector('.chartgrab');
      out.dataset.idle = 'Move across the charts to read any point.';
      function draw() {
        var from = Math.max(0, Math.round(view.i0));
        var to = Math.min(n, Math.round(view.i1));
        if (to - from < 8) to = Math.min(n, from + 8);
        pane.innerHTML = chartsHTML(run, from, to, true);
        box.dataset.count = to - from;
        box.dataset.from = from;
        var kmA = run.d && run.d[from] != null ? (run.d[from] / 1000).toFixed(2) : '0';
        var kmB = run.d && run.d[to - 1] != null ? (run.d[to - 1] / 1000).toFixed(2) : '?';
        body.querySelector('#zoomrange').textContent =
          'Showing ' + kmA + ' km to ' + kmB + ' km of the run.';
      }
      attachProbe(grab, box, out, run);
      out.textContent = out.dataset.idle;
      function zoom(k) {                       // k < 1 zooms in, around the middle
        var mid = (view.i0 + view.i1) / 2, half = (view.i1 - view.i0) * k / 2;
        view.i0 = Math.max(0, mid - half); view.i1 = Math.min(n, mid + half);
        draw();
      }
      function pan(dir) {
        var span = view.i1 - view.i0, step = span * 0.35 * dir;
        if (view.i0 + step < 0) step = -view.i0;
        if (view.i1 + step > n) step = n - view.i1;
        view.i0 += step; view.i1 += step;
        draw();
      }
      body.addEventListener('click', function (e) {
        var b = e.target.closest('button[data-act]');
        if (!b) return;
        var a = b.dataset.act;
        if (a === 'in') zoom(0.5);
        else if (a === 'out') zoom(2);
        else if (a === 'left') pan(-1);
        else if (a === 'right') pan(1);
        else { view.i0 = 0; view.i1 = n; draw(); }
      });
      /*
       * Pinch and two-finger drag on the charts. The window follows the fingers
       * continuously - spread them a little and it widens a little - instead of
       * jumping a whole step at a time. Redraws are tied to the screen's own
       * refresh so it stays smooth.
       */
      var pinch = null, queued = false;
      function schedule() {
        if (queued) return;
        queued = true;
        requestAnimationFrame(function () { queued = false; draw(); });
      }
      function fingers(e) {
        return {
          d: Math.max(20, Math.hypot(e.touches[0].clientX - e.touches[1].clientX,
                                     e.touches[0].clientY - e.touches[1].clientY)),
          x: (e.touches[0].clientX + e.touches[1].clientX) / 2
        };
      }
      grab.addEventListener('touchstart', function (e) {
        if (e.touches.length !== 2) return;
        var f = fingers(e);
        var rect = grab.getBoundingClientRect();
        pinch = { d: f.d, x: f.x, i0: view.i0, i1: view.i1,
                  anchor: Math.min(1, Math.max(0, (f.x - rect.left) / rect.width)) };
      }, { passive: true });
      grab.addEventListener('touchmove', function (e) {
        if (!pinch || e.touches.length !== 2) return;
        e.preventDefault();
        var f = fingers(e), rect = grab.getBoundingClientRect();
        var span = pinch.i1 - pinch.i0;
        var fresh = Math.max(8, Math.min(n, span / (f.d / pinch.d)));
        // keep whatever sits under the middle of the fingers in place
        var at = pinch.i0 + span * pinch.anchor;
        var start = at - fresh * pinch.anchor - (f.x - pinch.x) / rect.width * fresh;
        view.i0 = Math.max(0, Math.min(n - fresh, start));
        view.i1 = view.i0 + fresh;
        schedule();
      }, { passive: false });
      function stopPinch() { pinch = null; }
      grab.addEventListener('touchend', stopPinch);
      grab.addEventListener('touchcancel', stopPinch);
      draw();
    });
  }
