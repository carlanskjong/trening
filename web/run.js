(function () {
  var runs = window.RUNS || [], conf = window.CONF || {}, byId = {};
  runs.forEach(function (r) { byId[r.id] = r; });
  var host = document.getElementById('rundetail');
  if (!host) return;

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
  function dateText(iso) {
    var d = new Date(iso.replace(' ', 'T'));
    return conf.days[(d.getDay() + 6) % 7] + ' ' + pad(d.getDate()) + '.' + pad(d.getMonth() + 1) + '.' +
      d.getFullYear() + ' · ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }
  // ---------- the route, on a map you can drag and zoom ----------
  function decodePoly(str) {
    var pts = [], i = 0, lat = 0, lng = 0, b, shift, result;
    while (i < str.length) {
      shift = 0; result = 0;
      do { b = str.charCodeAt(i++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
      lat += (result & 1) ? ~(result >> 1) : (result >> 1);
      shift = 0; result = 0;
      do { b = str.charCodeAt(i++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
      lng += (result & 1) ? ~(result >> 1) : (result >> 1);
      pts.push([lat / 1e5, lng / 1e5]);
    }
    return pts;
  }
  function project(lat, lng, z) {            // web mercator, in tile units
    var n = Math.pow(2, z), s = Math.sin(lat * Math.PI / 180);
    return [(lng + 180) / 360 * n, (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n];
  }

  var ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services/';
  var LAYERS = [
    // A quiet grey basemap, so the route is the thing you see. It has a light and a
    // dark version, and follows whichever appearance the app is in.
    { id: 'plain', name: 'Plain', max: 16, attrib: '© Esri, © OpenStreetMap',
      url: ESRI + 'Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}',
      darkUrl: ESRI + 'Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}' },
    { id: 'streets', name: 'Streets', max: 19, attrib: '© OpenStreetMap',
      url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png' },
    { id: 'satellite', name: 'Satellite', max: 19, attrib: 'Imagery © Esri',
      url: ESRI + 'World_Imagery/MapServer/tile/{z}/{y}/{x}' }
  ];
  function layerById(id) {
    for (var i = 0; i < LAYERS.length; i++) if (LAYERS[i].id === id) return LAYERS[i];
    return LAYERS[0];
  }

  /* ----------------------------------------------------------------
   * Route styles
   *
   * Strava calls these "stat maps": the line is coloured by what you were
   * doing at that point of the run rather than being one flat colour. The same
   * ideas are here, with the app's own zone colours for heart rate so the map
   * matches the zone bars on every other page.
   *
   * Everything below is deliberately generic - a style is a recipe of stroked
   * layers - because the heat map page will draw many routes with the same
   * code, just fed overlap counts instead of heart rate.
   * -------------------------------------------------------------- */

  // Zone colours, matching --s1..--s4 in the stylesheet. Fixed rather than read
  // from CSS: over a map photo these have to stay readable in either appearance.
  var ZONE_INK = { easy: '#2a78d6', moderate: '#eb6834', threshold: '#1baf7a',
                   hard: '#eda100', nohr: '#b8b7b1' };

  function hex2rgb(h) {
    return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  }
  // A colour t of the way (0..1) along a list of stops.
  function ramp(stops, t) {
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    var f = t * (stops.length - 1), i = Math.min(stops.length - 2, Math.floor(f)), k = f - i;
    var a = hex2rgb(stops[i]), b = hex2rgb(stops[i + 1]);
    return 'rgb(' + Math.round(a[0] + (b[0] - a[0]) * k) + ',' +
      Math.round(a[1] + (b[1] - a[1]) * k) + ',' +
      Math.round(a[2] + (b[2] - a[2]) * k) + ')';
  }

  var PACE_RAMP = ['#3b6fd4', '#1ca37a', '#eda100', '#e8462a'];   // slow to fast
  var ELEV_RAMP = ['#2e8b57', '#9dbb3f', '#e0b03c', '#9c5a2c'];   // low to high

  /*
   * A style says how to draw the line. `layers` are stroked one after another,
   * widest first, so a casing or a glow can sit under the route itself.
   * `metric` names which stream colours it; without one the line is flat.
   */
  var ROUTE_STYLES = [
    { id: 'solid', name: 'Solid', swatch: '#e8462a',
      hint: 'One clear line with a contrasting edge.',
      layers: [{ w: 7, casing: true }, { w: 4, color: '#e8462a' }] },
    { id: 'glow', name: 'Glow', swatch: '#ff7a2f',
      hint: 'The warm heat-map look - best on satellite and in dark mode.',
      layers: [{ w: 17, color: '#ff5e14', op: 0.16 }, { w: 10, color: '#ff7a2f', op: 0.34 },
               { w: 4.5, color: '#ffc061', op: 0.95 }, { w: 1.6, color: '#fff3d6' }] },
    { id: 'hr', name: 'Heart rate', swatch: '#1baf7a', metric: 'hr',
      hint: 'Coloured by the zone you were in, like the zone bars.',
      layers: [{ w: 7.5, casing: true }, { w: 4.5, metric: true }] },
    { id: 'pace', name: 'Pace', swatch: '#3b6fd4', metric: 'sp',
      hint: 'Blue where you ran slowest, red where you ran fastest.',
      layers: [{ w: 7.5, casing: true }, { w: 4.5, metric: true }] },
    { id: 'elev', name: 'Elevation', swatch: '#9dbb3f', metric: 'al',
      hint: 'Green in the low places, brown on the high ground.',
      layers: [{ w: 7.5, casing: true }, { w: 4.5, metric: true }] }
  ];
  // A swatch that looks like the line the style draws: flat for the plain ones,
  // the colour ramp itself for the ones that paint by a stream.
  ROUTE_STYLES.forEach(function (s) {
    var stops = s.id === 'hr'
      ? [ZONE_INK.easy, ZONE_INK.moderate, ZONE_INK.threshold, ZONE_INK.hard]
      : s.id === 'pace' ? PACE_RAMP : s.id === 'elev' ? ELEV_RAMP : null;
    s.ink = stops ? 'linear-gradient(to right,' + stops.join(',') + ')' : s.swatch;
  });
  function styleById(id) {
    for (var i = 0; i < ROUTE_STYLES.length; i++) if (ROUTE_STYLES[i].id === id) return ROUTE_STYLES[i];
    return ROUTE_STYLES[0];
  }
  var savedStyle = (function () {
    try { return localStorage.getItem('pref-route') || 'solid'; } catch (e) { return 'solid'; }
  })();

  /*
   * Line up a stream with the drawn route.
   *
   * The two do not match point for point: the route comes from Strava's
   * summary_polyline, which keeps more points on bends and fewer on straights,
   * while the streams are ~160 evenly spaced samples. So walk the route adding
   * up its length, and for each point look up the sample at the same distance
   * into the run. Returns one value per route point, or null when that stream
   * was never recorded.
   */
  function alongRoute(run, pts, key) {
    var stream = run[key];
    if (!stream || !stream.length || !run.d || !run.d.length || pts.length < 2) return null;
    var cum = [0], i, total;
    for (i = 1; i < pts.length; i++) {
      var dy = pts[i][0] - pts[i - 1][0];
      var dx = (pts[i][1] - pts[i - 1][1]) * Math.cos(pts[i][0] * Math.PI / 180);
      cum.push(cum[i - 1] + Math.sqrt(dx * dx + dy * dy));
    }
    total = cum[cum.length - 1];
    var runEnd = run.d[run.d.length - 1];
    if (!total || !runEnd) return null;
    var out = [], j = 0, any = false;
    for (i = 0; i < pts.length; i++) {
      var want = cum[i] / total * runEnd;
      while (j < run.d.length - 1 && run.d[j + 1] < want) j++;
      var v = stream[j];
      // A zero means "not recorded" for heart rate and speed. For altitude it
      // means sea level, which is a real height.
      if (v == null || (v === 0 && key !== 'al')) { out.push(null); } else { out.push(v); any = true; }
    }
    return any ? out : null;
  }

  // The colour for one point, 0..1 of the way through the metric's range.
  function metricColor(styleId, value, lo, hi, maxhr) {
    if (value == null) return null;
    if (styleId === 'hr') {
      var pct = value / (maxhr || 205) * 100;
      return ZONE_INK[pct < 75 ? 'easy' : pct < 82 ? 'moderate' : pct < 88 ? 'threshold' : 'hard'];
    }
    var t = hi > lo ? (value - lo) / (hi - lo) : 0.5;
    return ramp(styleId === 'elev' ? ELEV_RAMP : PACE_RAMP, t);
  }
  var savedLayer = (function () {
    try { return localStorage.getItem('dash-layer') || localStorage.getItem('pref-map') || 'plain'; }
    catch (e) { return 'plain'; }
  })();
  function isDark() {
    var set = document.documentElement.getAttribute('data-theme');
    if (set) return set === 'dark';
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  }
  // Tiles are 256px pictures. On a phone screen that is two device pixels per CSS
  // pixel they look soft, so fetch one zoom level deeper and draw them at half
  // size - four sharper tiles in place of one blurry one.
  var DPR = Math.min(2, Math.round(window.devicePixelRatio || 1));
  var FINER = DPR >= 2 ? 1 : 0;
  var TILE = 256 / (FINER ? 2 : 1);

  /*
   * A small slippy map, written by hand so the dashboard needs no third-party
   * JavaScript. Tiles and the route live in ONE moving layer, so a pinch scales
   * both together and the route can never lag behind the map under it.
   */
  function SlippyMap(el, points, opts) {
    opts = opts || {};
    var self = this;
    this.el = el;
    this.pts = points || [];
    this.layer = layerById(savedLayer);
    this.style = styleById(savedStyle);
    this.run = opts.run || null;
    this.maxhr = (window.CONF && CONF.maxhr) || 205;
    // Every stream the route can be coloured by, lined up with the drawn points
    // once here rather than on each of the many redraws a drag causes.
    this.metrics = {};
    if (this.run) {
      this.metrics.hr = alongRoute(this.run, this.pts, 'hs');
      this.metrics.sp = alongRoute(this.run, this.pts, 'sp');
      this.metrics.al = alongRoute(this.run, this.pts, 'al');
    }
    if (this.style.metric && !this.metrics[this.style.metric]) this.style = ROUTE_STYLES[0];
    this.z = 14; this.cx = 0; this.cy = 0;          // centre, in pixels at zoom z
    el.classList.add('map');
    el.innerHTML = '<div class="mapinner">' +
      '<div class="maptiles"></div>' +
      '<svg class="route" preserveAspectRatio="none"></svg></div>' +
      '<div class="mapctl">' +
      LAYERS.map(function (l) {
        return '<button type="button" data-layer="' + l.id + '">' + l.name + '</button>';
      }).join('') + '</div>' +
      '<div class="mapzoom"><button type="button" data-zoom="1" aria-label="Zoom in">+</button>' +
      '<button type="button" data-zoom="-1" aria-label="Zoom out">−</button></div>' +
      '<div class="mapstyle"><button type="button" class="stylebtn" aria-haspopup="true">' +
      '<span class="stylewatch"></span><span class="stylename"></span></button>' +
      '<div class="stylemenu" hidden>' + ROUTE_STYLES.map(function (s) {
        return '<button type="button" data-style="' + s.id + '" title="' + s.hint + '">' +
          '<span class="stylewatch" style="background:' + s.ink + '"></span>' +
          s.name + '</button>';
      }).join('') + '</div></div>' +
      '<div class="maplegend" hidden></div>' +
      (opts.expand ? '<button type="button" class="mapbig" title="Bigger">⤢</button>' : '') +
      '<span class="attrib"></span>';
    this.inner = el.querySelector('.mapinner');
    this.tiles = el.querySelector('.maptiles');
    this.svg = el.querySelector('.route');
    this.menu = el.querySelector('.stylemenu');
    this.legend = el.querySelector('.maplegend');
    this.attrib = el.querySelector('.attrib');
    this.fit();
    this.bind(opts);
  }

  // The lowest and highest value of the stream this style paints with, ignoring
  // the extremes so one GPS spike cannot flatten the whole colour range.
  SlippyMap.prototype.span = function () {
    var vals = (this.metrics[this.style.metric] || []).filter(function (v) { return v != null; });
    if (vals.length < 4) return null;
    vals = vals.slice().sort(function (a, b) { return a - b; });
    var lo = vals[Math.floor(vals.length * 0.05)], hi = vals[Math.floor(vals.length * 0.95)];
    return hi > lo ? [lo, hi] : [vals[0], vals[vals.length - 1]];
  };

  /*
   * The route as SVG. `xy` holds the screen position of every point.
   *
   * A flat style is one cheap <polyline> per layer. A coloured one needs its
   * own stroke per step, so those layers become a run of two-point paths; the
   * round line caps make them join up seamlessly.
   */
  SlippyMap.prototype.routeSVG = function (xy) {
    var self = this, style = this.style, out = '';
    var vals = style.metric ? this.metrics[style.metric] : null;
    var range = vals ? this.span() : null;
    var flat = 'M' + xy.join('L');
    style.layers.forEach(function (lay) {
      var stroke = lay.casing ? 'var(--routecase)' : lay.color;
      var op = lay.op == null ? '' : ' stroke-opacity="' + lay.op + '"';
      if (!lay.metric || !vals || !range) {
        out += '<path class="rline" d="' + flat + '" stroke="' +
          (stroke || '#e8462a') + '" stroke-width="' + lay.w + '"' + op + '/>';
        return;
      }
      for (var i = 1; i < xy.length; i++) {
        var c = metricColor(style.id, vals[i], range[0], range[1], self.maxhr);
        if (!c) continue;
        out += '<path class="rline" d="M' + xy[i - 1] + 'L' + xy[i] + '" stroke="' + c +
          '" stroke-width="' + lay.w + '"/>';
      }
    });
    return out + '<circle class="startdot" r="5" cx="' + xy[0].split(',')[0] +
      '" cy="' + xy[0].split(',')[1] + '"/>';
  };

  // The key under the map: what the colours actually mean.
  SlippyMap.prototype.drawLegend = function () {
    var style = this.style, vals = style.metric ? this.metrics[style.metric] : null;
    var range = vals ? this.span() : null;
    if (!style.metric || !range) { this.legend.hidden = true; return; }
    this.legend.hidden = false;
    var lo = range[0], hi = range[1], fill, text;
    if (style.id === 'hr') {
      // The zones are steps, not a fade, so the bar gets hard edges.
      fill = 'linear-gradient(to right,' + ['easy', 'moderate', 'threshold', 'hard']
        .map(function (k, i) {
          return ZONE_INK[k] + ' ' + (i * 25) + '% ' + ((i + 1) * 25) + '%';
        }).join(',') + ')';
      text = ['Easy', 'Hard'];
    } else {
      var stops = style.id === 'elev' ? ELEV_RAMP : PACE_RAMP;
      fill = 'linear-gradient(to right,' + stops.join(',') + ')';
      text = style.id === 'pace' ? [pace(100000 / lo), pace(100000 / hi)]
                                 : [Math.round(lo) + ' m', Math.round(hi) + ' m'];
    }
    this.legend.innerHTML = '<b>' + text[0] + '</b><i style="background:' + fill +
      '"></i><b>' + text[1] + '</b>';
  };

  SlippyMap.prototype.setStyle = function (id) {
    this.style = styleById(id);
    try { localStorage.setItem('pref-route', id); } catch (e) {}
    savedStyle = id;
    this.menu.hidden = true;
    this.render();
  };

  SlippyMap.prototype.size = function () {
    return [this.el.clientWidth || 320, this.el.clientHeight || 200];
  };

  SlippyMap.prototype.fit = function () {
    var s = this.size(), w = s[0], h = s[1], pad = 26, z, i, p, xs, ys;
    if (!this.pts.length) { this.render(); return; }
    for (z = this.layer.max; z > 2; z--) {
      xs = []; ys = [];
      for (i = 0; i < this.pts.length; i++) {
        p = project(this.pts[i][0], this.pts[i][1], z); xs.push(p[0]); ys.push(p[1]);
      }
      if ((Math.max.apply(null, xs) - Math.min.apply(null, xs)) * 256 <= w - 2 * pad &&
          (Math.max.apply(null, ys) - Math.min.apply(null, ys)) * 256 <= h - 2 * pad) break;
    }
    this.z = z;
    this.cx = (Math.min.apply(null, xs) + Math.max.apply(null, xs)) / 2 * 256;
    this.cy = (Math.min.apply(null, ys) + Math.max.apply(null, ys)) / 2 * 256;
    this.render();
  };

  SlippyMap.prototype.tileUrl = function (x, y, z) {
    var n = Math.pow(2, z), wx = ((x % n) + n) % n;
    var url = (this.layer.darkUrl && isDark()) ? this.layer.darkUrl : this.layer.url;
    return url.replace('{z}', z).replace('{x}', wx).replace('{y}', y)
      .replace('{s}', this.layer.subs ? this.layer.subs[(wx + y) % this.layer.subs.length] : 'a');
  };

  SlippyMap.prototype.render = function () {
    var s = this.size(), w = s[0], h = s[1];
    var left = this.cx - w / 2, top = this.cy - h / 2;
    // Tiles come from one zoom deeper on a sharp screen, drawn at half size.
    var tz = Math.min(this.z + FINER, this.layer.max + FINER), n = Math.pow(2, tz);
    var scale = Math.pow(2, tz - this.z);       // world pixels per css pixel
    var tileCss = 256 / scale;
    var x0 = Math.floor(left * scale / 256), x1 = Math.floor((left + w) * scale / 256);
    var y0 = Math.floor(top * scale / 256), y1 = Math.floor((top + h) * scale / 256);
    var html = '', x, y;
    for (x = x0; x <= x1; x++) {
      for (y = Math.max(y0, 0); y <= Math.min(y1, n - 1); y++) {
        html += '<img class="maptile" alt="" onerror="this.style.visibility=\'hidden\'" src="' +
          this.tileUrl(x, y, tz) + '" style="width:' + tileCss + 'px;height:' + tileCss +
          'px;left:' + (x * tileCss - left).toFixed(2) + 'px;top:' +
          (y * tileCss - top).toFixed(2) + 'px">';
      }
    }
    this.tiles.innerHTML = html;
    this.inner.style.transform = '';
    this.attrib.textContent = this.layer.attrib;
    this.svg.setAttribute('viewBox', '0 0 ' + w + ' ' + h);
    var xy = [], p;
    for (var i = 0; i < this.pts.length; i++) {
      p = project(this.pts[i][0], this.pts[i][1], this.z);
      xy.push((p[0] * 256 - left).toFixed(1) + ',' + (p[1] * 256 - top).toFixed(1));
    }
    this.svg.innerHTML = xy.length ? this.routeSVG(xy) : '';
    var ctl = this.el.querySelectorAll('.mapctl button');
    for (var c = 0; c < ctl.length; c++) {
      ctl[c].classList.toggle('on', ctl[c].dataset.layer === this.layer.id);
    }
    // A style whose stream this run never recorded would draw a flat line with
    // a misleading name, so offer only the ones there is data for.
    var self = this;
    var opts = this.el.querySelectorAll('.stylemenu button');
    for (var s = 0; s < opts.length; s++) {
      var st = styleById(opts[s].dataset.style);
      opts[s].hidden = !!(st.metric && !self.metrics[st.metric]);
      opts[s].classList.toggle('on', st.id === this.style.id);
    }
    this.el.querySelector('.stylename').textContent = this.style.name;
    this.el.querySelector('.stylebtn .stylewatch').style.background = this.style.ink;
    this.drawLegend();
  };

  // Zoom by a whole step, keeping whatever is under (ax, ay) where it is.
  SlippyMap.prototype.zoomBy = function (step, ax, ay) {
    this.zoomTo(this.z + step, ax, ay);
  };

  SlippyMap.prototype.zoomTo = function (z, ax, ay) {
    var s = this.size();
    z = Math.max(3, Math.min(this.layer.max, Math.round(z)));
    if (z === this.z) { this.render(); return; }
    ax = ax == null ? s[0] / 2 : ax; ay = ay == null ? s[1] / 2 : ay;
    var wx = this.cx - s[0] / 2 + ax, wy = this.cy - s[1] / 2 + ay;
    var k = Math.pow(2, z - this.z);
    this.cx = wx * k - (ax - s[0] / 2); this.cy = wy * k - (ay - s[1] / 2);
    this.z = z;
    this.render();
  };

  SlippyMap.prototype.setLayer = function (id) {
    this.layer = layerById(id);
    try { localStorage.setItem('dash-layer', id); } catch (e) {}
    savedLayer = id;
    if (this.z > this.layer.max) this.zoomTo(this.layer.max);
    else this.render();
  };

  SlippyMap.prototype.bind = function (opts) {
    var self = this, el = this.el, drag = null, pinch = null;

    el.addEventListener('pointerdown', function (e) {
      if (e.target.closest('button') || pinch) return;
      drag = { x: e.clientX, y: e.clientY };
      el.setPointerCapture(e.pointerId);
      el.classList.add('grabbing');
    });
    el.addEventListener('pointermove', function (e) {
      if (!drag || pinch) return;
      self.cx -= e.clientX - drag.x;
      self.cy -= e.clientY - drag.y;
      drag.x = e.clientX; drag.y = e.clientY;
      self.render();
    });
    function endDrag(e) {
      if (!drag) return;
      drag = null;
      el.classList.remove('grabbing');
      try { el.releasePointerCapture(e.pointerId); } catch (err) {}
    }
    el.addEventListener('pointerup', endDrag);
    el.addEventListener('pointercancel', endDrag);

    el.addEventListener('wheel', function (e) {
      e.preventDefault();
      var r = el.getBoundingClientRect();
      self.zoomBy(e.deltaY < 0 ? 1 : -1, e.clientX - r.left, e.clientY - r.top);
    }, { passive: false });
    el.addEventListener('dblclick', function (e) {
      var r = el.getBoundingClientRect();
      self.zoomBy(1, e.clientX - r.left, e.clientY - r.top);
    });

    /*
     * Pinch. While two fingers are down the whole layer - tiles and route
     * together - is scaled and shifted with a CSS transform, which the phone
     * does on every frame. Nothing is redrawn until the fingers lift, and then
     * the map settles on the nearest whole zoom level and the tiles come back
     * sharp.
     */
    function centreOf(e, rect) {
      return [(e.touches[0].clientX + e.touches[1].clientX) / 2 - rect.left,
              (e.touches[0].clientY + e.touches[1].clientY) / 2 - rect.top];
    }
    function spread(e) {
      return Math.hypot(e.touches[0].clientX - e.touches[1].clientX,
                        e.touches[0].clientY - e.touches[1].clientY);
    }
    el.addEventListener('touchstart', function (e) {
      if (e.touches.length !== 2) return;
      drag = null;
      var rect = el.getBoundingClientRect(), at = centreOf(e, rect);
      pinch = { d: spread(e), x: at[0], y: at[1], k: 1, dx: 0, dy: 0 };
      self.inner.style.transformOrigin = at[0] + 'px ' + at[1] + 'px';
    }, { passive: true });
    el.addEventListener('touchmove', function (e) {
      if (!pinch || e.touches.length !== 2) return;
      e.preventDefault();
      var rect = el.getBoundingClientRect(), at = centreOf(e, rect);
      pinch.k = spread(e) / pinch.d;
      pinch.dx = at[0] - pinch.x;
      pinch.dy = at[1] - pinch.y;
      self.inner.style.transform =
        'translate(' + pinch.dx.toFixed(1) + 'px,' + pinch.dy.toFixed(1) + 'px) scale(' +
        pinch.k.toFixed(4) + ')';
    }, { passive: false });
    function endPinch() {
      if (!pinch) return;
      var k = pinch.k || 1, ax = pinch.x, ay = pinch.y, dx = pinch.dx, dy = pinch.dy;
      pinch = null;
      self.inner.style.transform = '';
      var s = self.size();
      // undo the drag part of the gesture, then settle on a whole zoom level
      self.cx -= dx; self.cy -= dy;
      var target = Math.max(3, Math.min(self.layer.max, Math.round(self.z + Math.log(k) / Math.LN2)));
      if (target === self.z) { self.render(); return; }
      var wx = self.cx - s[0] / 2 + ax, wy = self.cy - s[1] / 2 + ay;
      var f = Math.pow(2, target - self.z);
      self.cx = wx * f - (ax - s[0] / 2); self.cy = wy * f - (ay - s[1] / 2);
      self.z = target;
      self.render();
    }
    el.addEventListener('touchend', endPinch);
    el.addEventListener('touchcancel', endPinch);

    el.addEventListener('click', function (e) {
      var b = e.target.closest('button');
      if (!b) { self.menu.hidden = true; return; }
      e.preventDefault();
      if (b.dataset.layer) self.setLayer(b.dataset.layer);
      else if (b.dataset.zoom) self.zoomBy(+b.dataset.zoom);
      else if (b.dataset.style) self.setStyle(b.dataset.style);
      else if (b.classList.contains('stylebtn')) self.menu.hidden = !self.menu.hidden;
      else if (b.classList.contains('mapbig') && opts.expand) opts.expand();
    });
  };

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
    return { hr: slice(run.hs), pace: smooth(pc), alt: slice(run.al), dist: slice(run.d), time: slice(run.t) };
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
  function attachProbe(surface, box, readout, run) {
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
      var bits = [run.d && run.d[j] != null ? (run.d[j] / 1000).toFixed(2) + ' km' : null,
        run.hs && run.hs[j] ? run.hs[j] + ' bpm' : null,
        run.sp && run.sp[j] > 40 ? pace(100000 / run.sp[j]) + ' /km' : null,
        run.t && run.t[j] != null ? hms(run.t[j]) : null,
        run.al && run.al[j] != null ? Math.round(run.al[j]) + ' m' : null];
      readout.textContent = bits.filter(Boolean).join('  ·  ');
    }
    function clear() {
      readout.textContent = readout.dataset.idle;
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
  async function encryptNotes(obj, password) {
    var salt = crypto.getRandomValues(new Uint8Array(16));
    var iv = crypto.getRandomValues(new Uint8Array(12));
    var key = await keyFor(password, salt, ROUNDS);
    var data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv }, key,
      new TextEncoder().encode(JSON.stringify(obj)));
    return JSON.stringify({ salt: b64.enc(salt), iv: b64.enc(iv),
      data: b64.enc(new Uint8Array(data)), rounds: ROUNDS });
  }
  async function decryptNotes(text, password) {
    var blob = JSON.parse(text);
    var key = await keyFor(password, b64.dec(blob.salt), blob.rounds);
    var plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64.dec(blob.iv) }, key,
      b64.dec(blob.data));
    return JSON.parse(new TextDecoder().decode(plain));
  }

  // Pull the newest notes file straight from the repo - no token needed, so a
  // note written on the phone shows up on the PC without waiting for a rebuild.
  async function pullNotes() {
    if (pulled || !conf.repo) return;
    pulled = true;
    var pw = store.password();
    if (!pw) return;
    try {
      var r = await fetch('https://raw.githubusercontent.com/' + conf.repo + '/main/notes.enc',
        { cache: 'no-store' });
      if (!r.ok) return;
      mergeNotes(NOTES, await decryptNotes(await r.text(), pw));
    } catch (e) { /* offline, no file yet, or a different password - not fatal */ }
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
        await encryptNotes(obj, pw)))), branch: 'main' };
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

  function pushNotes() { return putEncrypted('notes.enc', NOTES, 'Save run notes'); }

  var WHY = {
    'no-token': 'Saved on this device. Add a GitHub token below to sync it to your other devices.',
    'no-password': 'Saved on this device only - reopen the dashboard with your password to sync.',
    'no-repo': 'Saved on this device only - this build does not know which repo to write to.',
    'bad-token': 'Saved on this device. GitHub refused the token - check it has Contents: read and write.',
    'conflict': 'Saved on this device. The notes file changed elsewhere - press Save again.',
    'offline': 'Saved on this device. No connection to GitHub right now - press Save again later.',
    'http': 'Saved on this device. GitHub would not accept the change.'
  };

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
  /* ----------------------------------------------------------------
   * Settings
   *
   * Appearance and map style are per device: they live in this browser and
   * change the moment you tap them. The training settings change how the
   * dashboard is built, so they go to settings.enc in the repo the same way
   * notes do, and take effect on the next build.
   * ---------------------------------------------------------------- */
  var prefs = {
    get: function (k, fallback) {
      try { return localStorage.getItem('pref-' + k) || fallback; } catch (e) { return fallback; }
    },
    set: function (k, v) { try { localStorage.setItem('pref-' + k, v); } catch (e) {} }
  };

  function applyTheme(choice) {
    var root = document.documentElement;
    if (choice === 'light' || choice === 'dark') root.setAttribute('data-theme', choice);
    else root.removeAttribute('data-theme');
    var dark = choice === 'dark' ||
      (choice !== 'light' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', dark ? '#0d0d0d' : '#f9f9f7');
  }
  applyTheme(prefs.get('theme', 'system'));

  function markChosen(group, attr, value) {
    var buttons = document.querySelectorAll('#' + group + ' button');
    for (var i = 0; i < buttons.length; i++) {
      buttons[i].classList.toggle('on', buttons[i].dataset[attr] === value);
    }
  }

  function wireSettings() {
    var themes = document.getElementById('themechoice');
    if (!themes) return;
    markChosen('themechoice', 'theme', prefs.get('theme', 'system'));
    themes.addEventListener('click', function (e) {
      var b = e.target.closest('button');
      if (!b) return;
      prefs.set('theme', b.dataset.theme);
      applyTheme(b.dataset.theme);
      markChosen('themechoice', 'theme', b.dataset.theme);
    });

    markChosen('mapchoice', 'map', prefs.get('map', 'plain'));
    document.getElementById('mapchoice').addEventListener('click', function (e) {
      var b = e.target.closest('button');
      if (!b) return;
      prefs.set('map', b.dataset.map);
      markChosen('mapchoice', 'map', b.dataset.map);
    });

    // training settings start from what this build was made with
    var days = conf.planDays || {};
    ['threshold', 'easy', 'long'].forEach(function (k) {
      var sel = document.getElementById('setday-' + k);
      if (sel) sel.value = String(days[k]);
    });

    var status = document.getElementById('trainingstatus');
    document.getElementById('savetraining').addEventListener('click', async function () {
      var btn = this;
      btn.disabled = true;
      status.textContent = 'Saving…';
      var body = {
        max_hr: parseInt(document.getElementById('setmaxhr').value, 10) || conf.maxhr,
        plan_start: document.getElementById('setstart').value || conf.planStart,
        plan_days: {
          threshold: +document.getElementById('setday-threshold').value,
          easy: +document.getElementById('setday-easy').value,
          long: +document.getElementById('setday-long').value
        },
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
      notesSha = null;
      var out = document.getElementById('tokenstatus');
      if (!value) { out.textContent = 'Token removed from this device.'; return; }
      out.textContent = 'Checking…';
      var res = await pushNotes();
      out.textContent = res.ok ? 'Token works - your notes and settings now sync.'
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
        ['dash-pw', 'dash-page', 'dash-notes', 'gh-token', 'dash-layer'].forEach(function (k) {
          localStorage.removeItem(k);
        });
        sessionStorage.removeItem('dash-pw');
      } catch (e) {}
      location.reload();
    });
  }

  // ---------- the run page ----------
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
      rows + '</table></div><p class="hint">Green rows reached threshold heart rate (' +
      Math.round(conf.maxhr * 0.82) + '-' + (Math.round(conf.maxhr * 0.88) - 1) + ' bpm). A rep that stayed ' +
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
      '<p class="hint">Tap the charts to open them bigger, where you can zoom into a single interval.</p></section>';
  }

  var current = null, currentMap = null;

  window.showRun = function (id) {
    var run = byId[id];
    current = run || null;
    if (!run) {
      host.innerHTML = '<section class="card"><p class="sub">That run is not in the last 140 days.</p></section>';
      return;
    }
    document.title = 'Trening · ' + run.n;
    host.innerHTML =
      '<h1 class="runtitle">' + esc(run.n) + '</h1>' +
      '<p class="sub">' + dateText(run.dt) + '</p>' +
      '<section class="card nopad"><div class="mapwrap"></div>' + statGrid(run) + '</section>' +
      chartsBlock(run) + lapsBlock(run) + splitsBlock(run) + zoneBlock(run) + notesBlock(run) +
      '<p class="hint"><a href="https://www.strava.com/activities/' + run.id +
      '" target="_blank" rel="noopener">Open this run on Strava ↗</a></p>';

    var wrap = host.querySelector('.mapwrap');
    var pts = run.poly ? decodePoly(run.poly) : [];
    if (pts.length > 1) {
      currentMap = new SlippyMap(wrap, pts,
        { run: run, expand: function () { openBigMap(run, pts); } });
    } else {
      wrap.remove();
    }

    var box = document.getElementById('charts');
    if (box) {
      var out = document.getElementById('readout');
      out.dataset.idle = 'Move across the chart to read any point.';
      out.textContent = out.dataset.idle;
      box.dataset.from = 0;
      attachProbe(box, box, out, run);
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

  function openBigMap(run, pts) {
    openSheet(esc(run.n), '<div class="bigmap"></div>' +
      '<p class="hint">Drag to move, pinch or scroll to zoom. The buttons switch the ' +
      'background map, and the one at the bottom changes how the route is drawn.</p>',
    function (body) {
      var el = body.querySelector('.bigmap');
      setTimeout(function () { new SlippyMap(el, pts, { run: run }); }, 0);
    });
  }

  wireSettings();

  var resizeTimer = null;                      // the map is pixel-based, so redraw it on resize
  window.addEventListener('resize', function () {
    if (!current || !document.getElementById('run').classList.contains('on')) return;
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () {
      if (currentMap) { currentMap.fit(); }
    }, 250);
  });
})();

