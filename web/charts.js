  /* ================================================================
   * Charts
   *
   * Every chart is drawn here, in the browser, at the size it is shown: the
   * SVG is exactly as many pixels wide as its box, so labels are real 12 px
   * text and dots are real dots on any screen. (Scaling one fixed drawing
   * down to a phone is what made the old ones unreadable.)
   *
   * One small engine draws them all - a run's streams against distance,
   * weekly columns, dots over time, and the pace-against-heart-rate cloud.
   * A chart is a `spec` (axes and layers) and a `Plot` that draws the spec
   * for a `view` (the part of the axes in sight). Zooming only changes the
   * view and draws again.
   *
   * Hands: tap a chart and it opens full screen. There, one finger reads
   * values; two fingers pinch to zoom and drag to move; double-tap goes back
   * to the whole chart. With a mouse: hover reads, the wheel (or a trackpad
   * pinch) zooms, dragging moves, double-click resets.
   * ================================================================ */
  var clipSeq = 0;

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
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  // Round tick values: 1, 2 or 5 times a power of ten, or the first of `steps`
  // that gives no more than `count` ticks.
  function ticksFor(lo, hi, count, steps) {
    var span = Math.max(hi - lo, 1e-9), step = null;
    if (steps) {
      for (var i = 0; i < steps.length && step == null; i++) if (span / steps[i] <= count) step = steps[i];
      if (step == null) step = steps[steps.length - 1];
    } else {
      var raw = span / Math.max(count, 1), mag = Math.pow(10, Math.floor(Math.log(raw) / Math.LN10)), f = raw / mag;
      step = (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * mag;
    }
    var out = [];
    for (var v = Math.ceil(lo / step - 1e-9) * step; v <= hi + 1e-9; v += step) out.push(+v.toFixed(9));
    out.step = step;
    return out;
  }

  // Colour for a cadence: red when low, amber in the middle, green when good.
  var CAD_LOW = 160, CAD_GOOD = 170;
  function cadColour(v) {
    return mix([cssVar('--bad'), cssVar('--c-mid'), cssVar('--good')], (v - (CAD_LOW - 5)) / 20);
  }

  /* ---------------- drawing ---------------- */
  var LAYER = {
    // horizontal zone bands with their names at the right edge
    hbands: function (l, g) {
      return l.bands.map(function (b) {
        var a = g.sy(Math.min(b.hi, g.yhi)), c = g.sy(Math.max(b.lo, g.ylo));
        var y0 = Math.max(g.T, Math.min(a, c)), y1 = Math.min(g.T + g.ph, Math.max(a, c));
        if (y1 - y0 < 1) return '';
        return '<rect x="' + g.L + '" y="' + y0.toFixed(1) + '" width="' + g.pw + '" height="' + (y1 - y0).toFixed(1) +
          '" class="zb z' + b.key + '"/>' + (y1 - y0 >= 15 && b.label ? '<text x="' + (g.L + g.pw - 6) + '" y="' +
          (y0 + 12).toFixed(1) + '" class="zbl" text-anchor="end">' + b.label + '</text>' : '');
      }).join('');
    },
    // vertical zone bands (heart rate across) with their names on top
    vbands: function (l, g) {
      return l.bands.map(function (b) {
        var x0 = Math.max(g.L, g.sx(b.lo)), x1 = Math.min(g.L + g.pw, g.sx(b.hi));
        if (x1 - x0 < 1) return '';
        return '<rect x="' + x0.toFixed(1) + '" y="' + g.T + '" width="' + (x1 - x0).toFixed(1) + '" height="' + g.ph +
          '" class="zb z' + b.key + '"/>' + (x1 - x0 > 50 ? '<text x="' + ((x0 + x1) / 2).toFixed(1) + '" y="' +
          (g.T + 14) + '" class="zbl" text-anchor="middle">' + b.label + '</text>' : '');
      }).join('');
    },
    line: function (l, g) {
      var d = '', on = false, xs = l.xs, ys = l.ys;
      for (var i = 0; i < ys.length; i++) {
        if (ys[i] == null || xs[i] == null) { on = false; continue; }
        if (xs[i] < g.x0 && xs[i + 1] != null && xs[i + 1] < g.x0) continue;      // well out of view
        if (xs[i] > g.x1 && xs[i - 1] != null && xs[i - 1] > g.x1) { on = false; continue; }
        d += (on ? 'L' : 'M') + g.sx(xs[i]).toFixed(1) + ' ' + g.sy(ys[i]).toFixed(1);
        on = true;
      }
      if (!d) return '';
      var out = '';
      if (l.area) {
        var base = g.sy(g.ylo).toFixed(1), first = d.match(/^M([\d.-]+)/), last = d.match(/([\d.-]+) [\d.-]+$/);
        if (first && last) out += '<path d="' + d + 'L' + last[1] + ' ' + base + 'L' + first[1] + ' ' + base + 'Z" class="area ' + l.cls + '"/>';
      }
      return out + '<path d="' + d + '" class="ln ' + l.cls + '"/>';
    },
    dots: function (l, g) {
      var r = (l.r || 4) + (g.big ? 1 : 0), out = '';
      l.pts.forEach(function (p) {
        if (p.x < g.x0 || p.x > g.x1) return;
        var cx = g.sx(p.x).toFixed(1), cy = g.sy(p.y).toFixed(1);
        out += '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" class="dt ' + (p.cls || l.cls || '') + '"' +
          (p.fill ? ' style="fill:' + p.fill + '"' : '') + '/>';
      });
      return out;
    },
    cols: function (l, g) {
      var slot = g.pw / (g.x1 - g.x0), w = clamp(slot * 0.62, 3, 34), out = '';
      l.items.forEach(function (c) {
        if (c.x < g.x0 - 1 || c.x > g.x1 + 1) return;
        var x = g.sx(c.x) - w / 2;
        if (c.band) {
          var b0 = g.sy(c.band[1]), b1 = g.sy(c.band[0]);
          out += '<rect x="' + (g.sx(c.x) - slot * 0.46).toFixed(1) + '" y="' + b0.toFixed(1) + '" width="' +
            (slot * 0.92).toFixed(1) + '" height="' + Math.max(b1 - b0, 1).toFixed(1) + '" rx="3" class="rb"/>';
        }
        if (!(c.v > 0)) return;
        var y0 = g.sy(0), y1 = g.sy(c.v), h = Math.max(y0 - y1, 2), r = Math.min(4, h / 2, w / 2);
        y1 = y0 - h;
        out += '<path class="cl ' + (c.cls || '') + '" d="M' + x.toFixed(1) + ' ' + y0.toFixed(1) + 'V' + (y1 + r).toFixed(1) +
          'Q' + x.toFixed(1) + ' ' + y1.toFixed(1) + ' ' + (x + r).toFixed(1) + ' ' + y1.toFixed(1) +
          'H' + (x + w - r).toFixed(1) + 'Q' + (x + w).toFixed(1) + ' ' + y1.toFixed(1) + ' ' + (x + w).toFixed(1) + ' ' +
          (y1 + r).toFixed(1) + 'V' + y0.toFixed(1) + 'Z"/>';
      });
      return out;
    },
    guide: function (l, g) {
      if (l.y < g.ylo || l.y > g.yhi) return '';
      var y = g.sy(l.y).toFixed(1);
      return '<line x1="' + g.L + '" x2="' + (g.L + g.pw) + '" y1="' + y + '" y2="' + y + '" class="gd"/>' +
        '<text x="' + (g.L + g.pw - 4) + '" y="' + (y - 5) + '" class="tk" text-anchor="end">' + l.text + '</text>';
    }
  };

  /*
   * spec = {
   *   h(width)          height in px for a given width
   *   x: { lo, hi, fmt(v, step), steps?, minSpan, none? }   the whole x range
   *   y: { lo, hi, fmt(v, step), steps?, invert?, fit?(x0, x1), ticks?(lo, hi, n) }
   *   zoom: 'x' | 'xy'  (xy also zooms up and down, for the scatter)
   *   layers: [ {type, ...} ]   see LAYER
   *   tips:   [ {x, y, html} ]  points that answer a finger or the mouse, or
   *   probe:  { xs, ys, cls }    a stream the crosshair reads instead
   * }
   */
  function Plot(el, spec) {
    this.el = el; this.spec = spec; this.big = false;
    this.reset();
  }
  Plot.prototype.reset = function () {
    var s = this.spec;
    this.view = { x0: s.x.lo, x1: s.x.hi, y0: s.y.lo, y1: s.y.hi };
  };
  Plot.prototype.zoomed = function () {
    var s = this.spec, v = this.view;
    return v.x1 - v.x0 < (s.x.hi - s.x.lo) * 0.999 || v.y1 - v.y0 < (s.y.hi - s.y.lo) * 0.999;
  };
  Plot.prototype.draw = function (height) {
    var s = this.spec, v = this.view, el = this.el, W = el.clientWidth;
    if (!W) return;
    var H = height || s.h(W), ylo = v.y0, yhi = v.y1;
    if (s.y.fit && s.zoom !== 'xy') {
      var f = s.y.fit(v.x0, v.x1);
      if (f) { ylo = f[0]; yhi = f[1]; }
    }
    var L = s.left || 42, R = s.right || 10, T = 8, B = s.x.none ? 6 : 24;
    var pw = W - L - R, ph = H - T - B;
    var sx = function (x) { return L + (x - v.x0) / (v.x1 - v.x0) * pw; };
    var sy = function (y) {
      var k = (y - ylo) / (yhi - ylo);
      return s.y.invert ? T + k * ph : T + ph - k * ph;
    };
    var g = this.g = { W: W, H: H, L: L, T: T, pw: pw, ph: ph, sx: sx, sy: sy,
                       x0: v.x0, x1: v.x1, ylo: ylo, yhi: yhi, big: this.big };
    var out = [], id = 'clip' + (++clipSeq);
    var yt = (s.y.ticks ? s.y.ticks(ylo, yhi, Math.max(3, Math.floor(ph / 34)))
                        : ticksFor(ylo, yhi, Math.max(3, Math.floor(ph / 34)), s.y.steps));
    yt.forEach(function (t) {
      var y = sy(t);
      if (y < T - 1 || y > T + ph + 1) return;
      out.push('<line x1="' + L + '" x2="' + (L + pw) + '" y1="' + y.toFixed(1) + '" y2="' + y.toFixed(1) + '" class="gr"/>' +
        '<text x="' + (L - 7) + '" y="' + (y + 4).toFixed(1) + '" class="tk" text-anchor="end">' + s.y.fmt(t, yt.step) + '</text>');
    });
    // lines and bands stop exactly at the plot's edge; dots and columns get a
    // little room, so one sitting on the edge is not cut in half
    out.push('<clipPath id="' + id + '"><rect x="' + L + '" y="' + T + '" width="' + pw + '" height="' + ph + '"/></clipPath>' +
      '<clipPath id="' + id + 'p"><rect x="' + (L - 6) + '" y="' + (T - 6) + '" width="' + (pw + 12) +
      '" height="' + (ph + 12) + '"/></clipPath>');
    s.layers.forEach(function (l) {
      var roomy = l.type === 'dots' || l.type === 'cols';
      out.push('<g clip-path="url(#' + id + (roomy ? 'p' : '') + ')">' + LAYER[l.type](l, g) + '</g>');
    });
    out.push('<line x1="' + L + '" x2="' + (L + pw) + '" y1="' + (T + ph) + '" y2="' + (T + ph) + '" class="ax"/>');
    if (!s.x.none) {
      var xt = s.x.ticks ? s.x.ticks(v.x0, v.x1, Math.max(2, Math.floor(pw / 74)))
                         : ticksFor(v.x0, v.x1, Math.max(2, Math.floor(pw / 74)), s.x.steps);
      xt.forEach(function (t) {
        var x = sx(t);
        if (x < L - 1 || x > L + pw + 1) return;
        var anchor = x < L + 16 ? 'start' : x > L + pw - 16 ? 'end' : 'middle';
        out.push('<text x="' + x.toFixed(1) + '" y="' + (H - 6) + '" class="tk" text-anchor="' + anchor + '">' +
          s.x.fmt(t, xt.step) + '</text>');
      });
    }
    out.push('<g class="probe"></g>');
    el.innerHTML = '<svg width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '" class="plot" role="img"' +
      ' aria-label="' + esc(s.label || '') + '">' + out.join('') + '</svg>';
    this.probeG = el.querySelector('.probe');
  };
  // Pixel <-> data for this plot's current drawing.
  Plot.prototype.dataX = function (px) {
    var g = this.g;
    return g.x0 + (px - g.L) / g.pw * (g.x1 - g.x0);
  };
  Plot.prototype.dataY = function (py) {
    var g = this.g, k = (py - g.T) / g.ph;
    return this.spec.y.invert ? g.ylo + k * (g.yhi - g.ylo) : g.yhi - k * (g.yhi - g.ylo);
  };
  Plot.prototype.mark = function (html) { if (this.probeG) this.probeG.innerHTML = html || ''; };

  // The point nearest a spot on screen, if one is close enough to mean it.
  Plot.prototype.nearest = function (px, py) {
    var s = this.spec, g = this.g, best = null, bestD = Infinity;
    if (!g || !s.tips) return null;
    var byX = s.nearBy === 'x';
    s.tips.forEach(function (t) {
      if (t.x < g.x0 || t.x > g.x1) return;
      var dx = g.sx(t.x) - px, dy = byX ? 0 : g.sy(t.y) - py, dd = dx * dx + dy * dy;
      if (dd < bestD) { bestD = dd; best = t; }
    });
    var reach = byX ? Math.max(24, g.pw / (g.x1 - g.x0) / 2 + 2) : 44;
    return best && bestD <= reach * reach ? best : null;
  };

  /* ---------------- the floating tooltip ---------------- */
  function tipAt(html, x, y, above) {
    if (!html) { tipEl.style.display = 'none'; return; }
    var parts = html.split('|');
    tipEl.innerHTML = '<b>' + parts[0] + '</b>' + parts.slice(1).join('<br>');
    tipEl.style.display = 'block';
    var w = tipEl.offsetWidth, h = tipEl.offsetHeight;
    tipEl.style.left = clamp(x - w / 2, 8, window.innerWidth - w - 8) + 'px';
    tipEl.style.top = (above ? Math.max(8, y - h - 26) : Math.min(window.innerHeight - h - 8, y + 18)) + 'px';
  }

  /* ---------------- hands ----------------
   * `surface` hears the fingers and the mouse for a list of plots. It lies on
   * top of them and is never redrawn, so a pinch is not cut short when the
   * chart under the fingers is replaced mid-gesture.
   *   opts.zoom      pinch, wheel and drag change the view
   *   opts.probe     (plot, px, py, clientX, clientY, touch) a finger or the mouse is reading
   *   opts.touchRead false: a finger does not read, it only taps (and scrolls the page)
   *   opts.leave     ()  it stopped reading
   *   opts.tap       ()  a plain tap or click
   *   opts.changed   ()  the view changed
   * Plots that share an x axis (a run's charts) zoom together.
   * -------------------------------------------- */
  function hands(surface, plots, opts) {
    var queued = false, touched = 0;
    function redraw() {
      if (queued) return;
      queued = true;
      requestAnimationFrame(function () {
        queued = false;
        plots.forEach(function (p) { p.draw(p.height); });
        if (opts.changed) opts.changed();
      });
    }
    function plotAt(clientY) {
      for (var i = 0; i < plots.length; i++) {
        var r = plots[i].el.getBoundingClientRect();
        if (clientY >= r.top - 6 && clientY <= r.bottom + 6) return { p: plots[i], r: r };
      }
      return null;
    }
    function read(cx, cy, touch) {
      if (touch && opts.touchRead === false) return;
      var hit = plotAt(cy);
      if (!hit || !hit.p.g) { if (opts.leave) opts.leave(); return; }
      if (opts.probe) opts.probe(hit.p, cx - hit.r.left, cy - hit.r.top, cx, cy, touch);
    }
    // Move every plot's view; `fn(plot, view)` returns the new view.
    function setView(fn) {
      plots.forEach(function (p) {
        var s = p.spec, v = fn(p, p.view), minX = s.x.minSpan || (s.x.hi - s.x.lo) / 50;
        var sx = clamp(v.x1 - v.x0, minX, s.x.hi - s.x.lo);
        var x0 = clamp(v.x0, s.x.lo, s.x.hi - sx);
        var nv = { x0: x0, x1: x0 + sx, y0: p.view.y0, y1: p.view.y1 };
        if (s.zoom === 'xy') {
          var minY = s.y.minSpan || (s.y.hi - s.y.lo) / 30;
          var sy = clamp(v.y1 - v.y0, minY, s.y.hi - s.y.lo);
          var y0 = clamp(v.y0, s.y.lo, s.y.hi - sy);
          nv.y0 = y0; nv.y1 = y0 + sy;
        }
        p.view = nv;
      });
      redraw();
    }
    function reset() { plots.forEach(function (p) { p.reset(); }); redraw(); }

    // Zoom by `k` (<1 closer) around a point given in the plot's pixels.
    function zoomAround(p, px, py, k) {
      var ax = p.dataX(px), ay = p.dataY(py);
      setView(function (q, v) {
        var fx = (ax - v.x0) / (v.x1 - v.x0), out = { x0: ax - (v.x1 - v.x0) * k * fx };
        out.x1 = out.x0 + (v.x1 - v.x0) * k;
        if (q.spec.zoom === 'xy') {
          var fy = (ay - v.y0) / (v.y1 - v.y0);
          out.y0 = ay - (v.y1 - v.y0) * k * fy; out.y1 = out.y0 + (v.y1 - v.y0) * k;
        }
        return out;
      });
    }

    // ---- fingers
    var pinch = null, tap = null, lastTap = 0;
    function two(e, r) {
      var a = e.touches[0], b = e.touches[1];
      return { d: Math.max(24, Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY)),
               x: (a.clientX + b.clientX) / 2 - r.left, y: (a.clientY + b.clientY) / 2 - r.top };
    }
    surface.addEventListener('touchstart', function (e) {
      if (e.touches.length === 1) {
        var t = e.touches[0];
        tap = { x: t.clientX, y: t.clientY, at: Date.now() };
        read(t.clientX, t.clientY, true);
      } else {
        tap = null;
        if (opts.leave) opts.leave();
        if (!opts.zoom || e.touches.length !== 2) return;
        var hit = plotAt((e.touches[0].clientY + e.touches[1].clientY) / 2) || { p: plots[0], r: plots[0].el.getBoundingClientRect() };
        if (!hit.p.g) return;
        var f = two(e, hit.r), p = hit.p;
        pinch = { p: p, r: hit.r, f: f, views: plots.map(function (q) { return Object.assign({}, q.view); }),
                  ax: p.dataX(f.x), ay: p.dataY(f.y) };
      }
    }, { passive: true });
    surface.addEventListener('touchmove', function (e) {
      if (pinch && e.touches.length === 2) {
        e.preventDefault();
        var f = two(e, pinch.r), k = pinch.f.d / f.d, p = pinch.p, g = p.g;
        setView(function (q) {
          var v0 = pinch.views[plots.indexOf(q)], span = (v0.x1 - v0.x0) * k;
          var out = { x0: pinch.ax - (f.x - g.L) / g.pw * span };
          out.x1 = out.x0 + span;
          if (q.spec.zoom === 'xy') {
            var sy = (v0.y1 - v0.y0) * k, ky = (f.y - g.T) / g.ph;
            // screen down is data up unless the axis is inverted
            out.y0 = q.spec.y.invert ? pinch.ay - ky * sy : pinch.ay - (1 - ky) * sy;
            out.y1 = out.y0 + sy;
          }
          return out;
        });
        return;
      }
      if (e.touches.length === 1) {
        var t = e.touches[0];
        if (tap && Math.hypot(t.clientX - tap.x, t.clientY - tap.y) > 10) tap = null;
        read(t.clientX, t.clientY, true);
      }
    }, { passive: false });
    surface.addEventListener('touchend', function (e) {
      touched = Date.now();
      if (e.touches.length < 2) pinch = null;
      if (e.touches.length) return;
      if (tap && Date.now() - tap.at < 400) {
        var now = Date.now();
        if (opts.zoom && now - lastTap < 320) { reset(); lastTap = 0; }
        else { lastTap = now; if (opts.tap) { e.preventDefault(); opts.tap(); } }
      }
      tap = null;
    });
    surface.addEventListener('touchcancel', function () { pinch = null; tap = null; });

    // ---- mouse
    var drag = null, moved = false;
    surface.addEventListener('mousemove', function (e) {
      if (drag) {
        var p = drag.p, g = p.g, dx = e.clientX - drag.x, dy = e.clientY - drag.y;
        if (Math.abs(dx) + Math.abs(dy) > 3) moved = true;
        if (!opts.zoom || !moved) return;
        setView(function (q) {
          var v0 = drag.views[plots.indexOf(q)], ddx = -dx / g.pw * (v0.x1 - v0.x0);
          var out = { x0: v0.x0 + ddx, x1: v0.x1 + ddx };
          if (q.spec.zoom === 'xy') {
            var ddy = dy / g.ph * (v0.y1 - v0.y0) * (q.spec.y.invert ? -1 : 1);
            out.y0 = v0.y0 + ddy; out.y1 = v0.y1 + ddy;
          }
          return out;
        });
        return;
      }
      if (Date.now() - touched > 800) read(e.clientX, e.clientY, false);
    });
    surface.addEventListener('mousedown', function (e) {
      if (e.button !== 0 || Date.now() - touched < 800) return;
      var hit = plotAt(e.clientY);
      if (!hit || !hit.p.g) return;
      moved = false;
      drag = { p: hit.p, x: e.clientX, y: e.clientY, views: plots.map(function (q) { return Object.assign({}, q.view); }) };
      if (opts.zoom) surface.classList.add('grabbing');
      window.addEventListener('mouseup', drop);
    });
    function drop() {                     // listened for only while a button is down
      drag = null;
      surface.classList.remove('grabbing');
      window.removeEventListener('mouseup', drop);
    }
    surface.addEventListener('click', function () {
      if (moved) { moved = false; return; }
      // a finger's tap was handled on touchend; this is the click the browser adds after it
      if (opts.tap && Date.now() - touched > 800) opts.tap();
    });
    surface.addEventListener('mouseleave', function () { if (!drag && opts.leave) opts.leave(); });
    if (opts.zoom) {
      surface.addEventListener('wheel', function (e) {
        var hit = plotAt(e.clientY);
        if (!hit || !hit.p.g) return;
        e.preventDefault();
        // a trackpad pinch arrives as a wheel with ctrl held, in much bigger steps
        var k = Math.exp(e.deltaY * (e.ctrlKey ? 0.01 : 0.0018));
        zoomAround(hit.p, e.clientX - hit.r.left, e.clientY - hit.r.top, k);
      }, { passive: false });
      surface.addEventListener('dblclick', function (e) { e.preventDefault(); reset(); });
      // iOS Safari: a pinch here zooms the chart, not the whole page
      surface.addEventListener('gesturestart', function (e) { e.preventDefault(); });
    }
    return { redraw: redraw, reset: reset };
  }

  // Draw again when a chart's box changes size - a turned phone, a resized
  // window, or a page that was hidden (zero wide) being shown.
  var sizeWatch = window.ResizeObserver ? new ResizeObserver(function (entries) {
    entries.forEach(function (en) {
      if (!en.target.isConnected) { sizeWatch.unobserve(en.target); return; }     // its page was redrawn
      var p = en.target.__plot;
      if (p && en.contentRect.width && en.contentRect.width !== p.lastW) { p.lastW = en.contentRect.width; p.draw(p.height); }
    });
  }) : null;
  function watchSize(p) {
    p.el.__plot = p;
    if (sizeWatch) sizeWatch.observe(p.el);
    else window.addEventListener('resize', function () { p.draw(p.height); });
  }

  /* ---------------- the full-screen chart window ----------------
   * `build(body)` puts the charts into `body` and returns {plots, probe, leave,
   * weights, changed}. The plots then share the screen by `weights`.
   * -------------------------------------------------------------- */
  var TOUCH = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
  function openChartWindow(title, build) {
    return openSheet(title, '<div class="cw">' +
      '<p class="cw-hint">' + (TOUCH ? 'Pinch to zoom · two fingers to move · double-tap to reset'
                                     : 'Scroll to zoom · drag to move · double-click to reset') + '</p>' +
      '<div class="cw-read" aria-live="polite"></div><div class="cw-stack"></div>' +
      '<div class="cw-grab"></div><div class="cw-foot"></div></div>',
    function (body) {
      body.closest('.sheetbox').classList.add('tall');
      var stack = body.querySelector('.cw-stack'), grab = body.querySelector('.cw-grab');
      var made = build(stack, body.querySelector('.cw-read'), body.querySelector('.cw-foot'));
      var plots = made.plots, weights = made.weights || plots.map(function () { return 1; });
      plots.forEach(function (p) { p.big = true; });
      function size() {
        // share the height left over by the text around the charts
        var top = stack.getBoundingClientRect().top - body.getBoundingClientRect().top + body.scrollTop;
        var free = body.clientHeight - top - body.querySelector('.cw-foot').offsetHeight - 24;
        var total = weights.reduce(function (a, b) { return a + b; }, 0);
        var cap = made.maxH || 640;
        plots.forEach(function (p, i) {
          p.height = clamp(Math.floor(free * weights[i] / total) - (p.headH || 0), 130, cap);
          p.draw(p.height);
        });
        grab.style.top = stack.offsetTop + 'px';        // .cw is the positioned parent
        grab.style.height = stack.offsetHeight + 'px';
      }
      requestAnimationFrame(size);
      var onResize = function () { size(); };
      window.addEventListener('resize', onResize);
      hands(grab, plots, { zoom: true, probe: made.probe, leave: made.leave, changed: made.changed });
      var obs = new MutationObserver(function () {
        if (!document.body.contains(body)) { window.removeEventListener('resize', onResize); obs.disconnect(); tipAt(null); }
      });
      obs.observe(document.body, { childList: true });
    });
  }

  /* ================================================================
   * A run's charts: heart rate, pace, cadence and elevation, against distance
   * ================================================================ */
  function seriesFor(run) {
    var pc = (run.sp || []).map(function (v) { return v && v > 40 ? 100000 / v : null; });
    var km = run.d && run.d.length === (run.hs || run.sp || []).length
      ? run.d.map(function (v) { return v == null ? null : v / 1000; }) : null;
    var xs = km || (run.t || []).map(function (v) { return v / 60; });
    return { x: xs, byKm: !!km, hr: run.hs || [], pace: smooth(pc), alt: run.al || [],
             cad: (run.cd || []).map(function (v) { return v > 60 ? v : null; }) };
  }
  function visible(xs, ys, x0, x1) {
    var out = [];
    for (var i = 0; i < ys.length; i++) if (ys[i] != null && xs[i] >= x0 && xs[i] <= x1) out.push(ys[i]);
    return out;
  }
  function padRange(lo, hi, minSpan, k) {
    var span = Math.max(hi - lo, minSpan), mid = (lo + hi) / 2;
    return [mid - span / 2 - span * k, mid + span / 2 + span * k];
  }

  function runSpecs(run) {
    var s = seriesFor(run), n = s.x.length;
    if (n < 8) return [];
    var xEnd = s.x[n - 1] || 1;
    var X = {
      lo: 0, hi: xEnd, minSpan: s.byKm ? 0.3 : 2,
      fmt: function (v, step) {
        return s.byKm ? (step < 1 ? v.toFixed(1) : v.toFixed(0)) + ' km' : Math.round(v) + ' min';
      },
      steps: s.byKm ? [0.1, 0.2, 0.25, 0.5, 1, 2, 5, 10, 20] : [1, 2, 5, 10, 15, 30, 60]
    };
    var specs = [];
    function spec(key, label, unit, h, y, layers, extra) {
      specs.push(Object.assign({ key: key, label: label, unit: unit, h: h, x: X, y: y, zoom: 'x', layers: layers,
        probe: { xs: s.x, ys: s[key], cls: key } }, extra || {}));
    }
    var tall = function (base) { return function (w) { return Math.round(base * (w > 600 ? 1.2 : 1)); }; };

    if (s.hr.some(function (v) { return v; })) {
      var bands = conf.zones.map(function (z) {
        return { lo: conf.maxhr * z[2] / 100, hi: conf.maxhr * z[3] / 100, key: z[0], label: z[1] };
      });
      var edges = conf.zones.slice(1).map(function (z) { return Math.round(conf.maxhr * z[2] / 100); });
      var fitHr = function (a, b) {
        var v = visible(s.x, s.hr, a, b);
        return v.length ? padRange(Math.min.apply(null, v), Math.max.apply(null, v), 16, 0.08) : null;
      };
      var full = fitHr(0, xEnd);
      spec('hr', 'Heart rate', 'bpm', tall(170), {
        lo: full[0], hi: full[1], fit: fitHr,
        fmt: function (v) { return Math.round(v); },
        // the zone edges are the numbers worth reading; plain round numbers when none are in sight
        ticks: function (lo, hi, count) {
          var e = edges.filter(function (v) { return v > lo + 2 && v < hi - 2; });
          return e.length >= 2 ? e : ticksFor(lo, hi, count, [5, 10, 20, 25, 50]);
        }
      }, [{ type: 'hbands', bands: bands }, { type: 'line', xs: s.x, ys: s.hr, cls: 'hr' }]);
    }
    if (s.pace.filter(function (v) { return v; }).length > 5) {
      var fitPace = function (a, b) {
        var v = visible(s.x, s.pace, a, b);
        if (v.length < 3) return null;
        return padRange(percentile(v, 0.02), percentile(v, 0.97), 20, 0.06);
      };
      var fp = fitPace(0, xEnd);
      spec('pace', 'Pace', 'min/km · faster is higher', tall(140), {
        lo: fp[0], hi: fp[1], fit: fitPace, invert: true, fmt: pace, steps: [5, 10, 15, 20, 30, 60, 120, 300]
      }, [{ type: 'line', xs: s.x, ys: s.pace.map(function (v) { return v == null ? null : clamp(v, fp[0] - 60, fp[1] + 60); }), cls: 'pace' }]);
    }
    if (s.cad.filter(function (v) { return v; }).length > 5) {
      var pts = [];
      s.cad.forEach(function (v, i) { if (v) pts.push({ x: s.x[i], y: v, fill: cadColour(v) }); });
      var fitCad = function (a, b) {
        var v = visible(s.x, s.cad, a, b);
        if (v.length < 3) return null;
        // keep 160-170 in sight, so the colours have their scale next to them
        return padRange(Math.min(percentile(v, 0.02), CAD_LOW - 4), Math.max(percentile(v, 0.98), CAD_GOOD + 4), 20, 0.05);
      };
      var fc = fitCad(0, xEnd);
      spec('cad', 'Cadence', 'steps/min', tall(130), {
        lo: fc[0], hi: fc[1], fit: fitCad, fmt: function (v) { return Math.round(v); }, steps: [5, 10, 20]
      }, [{ type: 'dots', pts: pts, r: 2.6, cls: 'cad' }], { legend: cadLegend() });
    }
    if (s.alt.some(function (v) { return v != null; })) {
      var fitAlt = function (a, b) {
        var v = visible(s.x, s.alt, a, b);
        return v.length ? padRange(Math.min.apply(null, v), Math.max.apply(null, v), 20, 0.1) : null;
      };
      var fa = fitAlt(0, xEnd);
      spec('alt', 'Elevation', 'm', tall(110), {
        lo: fa[0], hi: fa[1], fit: fitAlt, fmt: function (v) { return Math.round(v) + ''; }, steps: [2, 5, 10, 20, 25, 50, 100, 200, 500]
      }, [{ type: 'line', xs: s.x, ys: s.alt, cls: 'alt', area: true }]);
    }
    specs.series = s;
    return specs;
  }

  function cadLegend() {
    return '<span class="cleg"><i style="background:' + cadColour(CAD_LOW - 5) + '"></i>under ' + CAD_LOW +
      '<i style="background:' + cadColour((CAD_LOW + CAD_GOOD) / 2) + '"></i>' + CAD_LOW + '–' + CAD_GOOD +
      '<i style="background:' + cadColour(CAD_GOOD + 5) + '"></i>' + CAD_GOOD + '+</span>';
  }

  // The HTML of one chart block: its heading and an empty box the Plot fills.
  function chartBlock(sp) {
    return '<div class="rc" data-k="' + sp.key + '"><div class="rc-head"><b>' + sp.label + '</b><span>' + sp.unit +
      '</span>' + (sp.legend || '') + '</div><div class="cv"></div></div>';
  }

  // The sample under a spot on a run chart: the one nearest in distance.
  function sampleNear(xs, xv) {
    var lo = 0, hi = xs.length - 1;
    while (hi - lo > 1) { var mid = (lo + hi) >> 1; if ((xs[mid] == null ? -1 : xs[mid]) < xv) lo = mid; else hi = mid; }
    return Math.abs(xs[hi] - xv) < Math.abs(xs[lo] - xv) ? hi : lo;
  }
  // Crosshair on every run chart at sample j, with a dot on each stream.
  function crosshair(plots, j) {
    plots.forEach(function (p) {
      var g = p.g, pr = p.spec.probe;
      if (!g) return;
      if (j == null) { p.mark(''); return; }
      var xv = pr.xs[j];
      if (xv == null || xv < g.x0 || xv > g.x1) { p.mark(''); return; }
      var x = g.sx(xv).toFixed(1), y = pr.ys[j], html = '<line x1="' + x + '" x2="' + x + '" y1="' + g.T + '" y2="' +
        (g.T + g.ph) + '" class="xh"/>';
      if (y != null) {
        var fill = p.spec.key === 'cad' ? ' style="fill:' + cadColour(y) + '"' : '';
        html += '<circle cx="' + x + '" cy="' + g.sy(clamp(y, Math.min(g.ylo, g.yhi), Math.max(g.ylo, g.yhi))).toFixed(1) +
          '" r="5" class="xd ' + pr.cls + '"' + fill + '/>';
      }
      p.mark(html);
    });
  }

  /*
   * The charts on a run page. `onIndex(j)` hears which sample a finger is on
   * (null when it lifts), so the map can follow.
   */
  function runCharts(box, readout, run, onIndex) {
    var specs = runSpecs(run);
    if (!specs.length) return null;
    box.innerHTML = specs.map(chartBlock).join('') + '<div class="cgrab"></div>';
    var plots = specs.map(function (sp, i) {
      var p = new Plot(box.querySelectorAll('.cv')[i], sp);
      watchSize(p);
      p.draw();
      return p;
    });
    var xs = specs.series.x;
    readout.dataset.idle = readout.textContent;
    hands(box.querySelector('.cgrab'), plots, {
      probe: function (p, px) {
        var j = sampleNear(xs, p.dataX(px));
        crosshair(plots, j);
        readout.textContent = readoutAt(run, j);
        if (onIndex) onIndex(j);
      },
      leave: function () {
        crosshair(plots, null);
        readout.textContent = readout.dataset.idle;
        if (onIndex) onIndex(null);
      },
      tap: function () { openRunCharts(run); }
    });
    return plots;
  }

  function openRunCharts(run) {
    openChartWindow(esc(run.n), function (stack, read) {
      var specs = runSpecs(run), xs = specs.series.x;
      stack.innerHTML = specs.map(chartBlock).join('');
      var plots = specs.map(function (sp, i) {
        var p = new Plot(stack.querySelectorAll('.cv')[i], sp);
        p.headH = 26;
        return p;
      });
      var idle = function () {
        var v = plots[0].view, whole = !plots[0].zoomed();
        return whole ? 'Touch the charts to read any point.'
          : 'Showing ' + X(v.x0) + ' to ' + X(v.x1) + ' of the run.';
      };
      function X(v) { return specs.series.byKm ? v.toFixed(2) + ' km' : Math.round(v) + ' min'; }
      read.textContent = idle();
      return {
        plots: plots, weights: specs.map(function (sp) { return { hr: 1.3, pace: 1.1, cad: 1, alt: 0.8 }[sp.key]; }),
        probe: function (p, px) {
          var j = sampleNear(xs, p.dataX(px));
          crosshair(plots, j);
          read.textContent = readoutAt(run, j);
        },
        leave: function () { crosshair(plots, null); read.textContent = idle(); },
        changed: function () { read.textContent = idle(); }
      };
    });
  }
