  /* ================================================================
   * Maps - MapLibre GL, a pinned and verified copy (see vendor/README.md)
   *
   * Every map source is free and needs no account or key:
   *   Map        OpenFreeMap "positron" / "dark" vector styles, tinted to the app
   *   Outdoor    OpenFreeMap "liberty" - paths, forest and contours for trails
   *   Satellite  Esri World Imagery
   *   Terrain    AWS Open Data elevation tiles (Mapzen "terrarium" encoding),
   *              used for the hillshading and for the ground in 3D
   * The library is loaded only when a map is first shown, so Home stays quick.
   * With no connection the basemap falls back to a plain background and the
   * route still draws, because the route itself is part of this page.
   * ================================================================ */
  var ML_DIR = 'vendor/maplibre-gl-6.11.1/';
  var OFM = 'https://tiles.openfreemap.org/';
  var GLYPHS = OFM + 'fonts/{fontstack}/{range}.pbf';
  var DEM_TILES = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';
  var SAT_TILES = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
  var LABEL_FONT = ['Noto Sans Bold'];

  var BASEMAPS = [
    { id: 'map', name: 'Map', hint: 'Clean and quiet, follows light or dark' },
    { id: 'outdoor', name: 'Outdoor', hint: 'Trails, forest and paths' },
    { id: 'satellite', name: 'Satellite', hint: 'Aerial photos' }
  ];
  var OLD_BASEMAP = { plain: 'map', streets: 'outdoor' };   // names used before September 2026

  function savedBasemap() {
    var v = prefs.get('map', 'map');
    v = OLD_BASEMAP[v] || v;
    return BASEMAPS.some(function (b) { return b.id === v; }) ? v : 'map';
  }

  var mlReady = null;
  function loadMapLibre() {
    if (!mlReady) {
      var link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = ML_DIR + 'maplibre-gl.css';
      document.head.appendChild(link);
      mlReady = import(new URL(ML_DIR + 'maplibre-gl.mjs', location.href).href)
        .catch(function (e) { mlReady = null; throw e; });
    }
    return mlReady;
  }

  function isDark() {
    var t = document.documentElement.getAttribute('data-theme');
    if (t) return t === 'dark';
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  }
  function cssVar(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }

  function styleFor(id) {
    if (id === 'satellite') {
      return {
        version: 8, glyphs: GLYPHS,
        sources: { sat: { type: 'raster', tiles: [SAT_TILES], tileSize: 256, maxzoom: 19,
          attribution: 'Imagery © Esri, Maxar, Earthstar Geographics' } },
        layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#0b1117' } },
                 { id: 'sat', type: 'raster', source: 'sat' }]
      };
    }
    if (id === 'outdoor') return OFM + 'styles/liberty';
    return OFM + 'styles/' + (isDark() ? 'dark' : 'positron');
  }
  // What is left when the basemap cannot load: the page colour, and the route on top.
  function blankStyle() {
    return { version: 8, glyphs: GLYPHS, sources: {},
      layers: [{ id: 'background', type: 'background',
        paint: { 'background-color': isDark() ? '#0f161d' : '#e5eaef' } }] };
  }

  // Positron and Dark are near-greys; nudge land and water to the app's fjord tones.
  function tint(map, basemap) {
    if (basemap !== 'map') return;
    var dark = isDark();
    [['background', 'background-color', dark ? '#0b1117' : '#eef1f4'],
     ['water', 'fill-color', dark ? '#12202c' : '#c6d5e0']].forEach(function (t) {
      if (map.getLayer(t[0])) { try { map.setPaintProperty(t[0], t[1], t[2]); } catch (e) {} }
    });
  }

  function firstLayerOf(map, types) {
    var layers = map.getStyle().layers || [];
    for (var i = 0; i < layers.length; i++) if (types.indexOf(layers[i].type) >= 0) return layers[i].id;
    return undefined;
  }

  // Two sources on the same tiles: MapLibre wants terrain and hillshade kept apart.
  function addGround(map, basemap) {
    var dem = { type: 'raster-dem', tiles: [DEM_TILES], tileSize: 256, maxzoom: 15, encoding: 'terrarium',
      attribution: 'Terrain: Mapzen, AWS Open Data' };
    if (!map.getSource('dem')) map.addSource('dem', dem);
    if (!map.getSource('dem-hs')) map.addSource('dem-hs', Object.assign({}, dem, { attribution: '' }));
    if (basemap === 'satellite' || map.getLayer('hillshade')) return;
    var dark = isDark();
    map.addLayer({ id: 'hillshade', type: 'hillshade', source: 'dem-hs', paint: {
      'hillshade-exaggeration': basemap === 'outdoor' ? 0.45 : 0.3,
      'hillshade-shadow-color': dark ? 'rgba(0,0,0,0.6)' : 'rgba(34,52,70,0.42)',
      'hillshade-highlight-color': dark ? 'rgba(255,255,255,0.05)' : 'rgba(255,255,255,0.55)',
      'hillshade-accent-color': 'rgba(0,0,0,0)'
    } }, firstLayerOf(map, ['line', 'symbol', 'fill-extrusion']));
  }

  function setGround3D(map, on) {
    if (on) {
      map.setTerrain({ source: 'dem', exaggeration: 1.4 });
      var dark = isDark();
      try {
        map.setSky({
          'sky-color': dark ? '#0b1624' : '#9ec3e6', 'horizon-color': dark ? '#1c2c3c' : '#e3edf5',
          'fog-color': dark ? '#0b1117' : '#eef1f4', 'sky-horizon-blend': 0.6,
          'horizon-fog-blend': 0.6, 'fog-ground-blend': 0.2, 'atmosphere-blend': 0.6
        });
      } catch (e) {}
    } else {
      map.setTerrain(null);
    }
  }

  /* ---------------- the route as geometry ---------------- */
  function decodePoly(str) {
    var pts = [], i = 0, lat = 0, lng = 0, b, shift, result;
    while (i < str.length) {
      shift = 0; result = 0;
      do { b = str.charCodeAt(i++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
      lat += (result & 1) ? ~(result >> 1) : (result >> 1);
      shift = 0; result = 0;
      do { b = str.charCodeAt(i++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
      lng += (result & 1) ? ~(result >> 1) : (result >> 1);
      pts.push([lng / 1e5, lat / 1e5]);                 // [lng, lat], the way MapLibre wants it
    }
    return pts;
  }
  function metres(a, b) {
    var R = 6371000, r = Math.PI / 180;
    var dLat = (b[1] - a[1]) * r, dLng = (b[0] - a[0]) * r;
    var h = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(a[1] * r) * Math.cos(b[1] * r) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return 2 * R * Math.asin(Math.sqrt(h));
  }

  var geoCache = {};
  function routeGeo(run) {
    if (geoCache[run.id] !== undefined) return geoCache[run.id];
    var c = run.poly ? decodePoly(run.poly) : [];
    if (c.length < 2) return (geoCache[run.id] = null);
    var cum = [0], w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
    for (var i = 0; i < c.length; i++) {
      if (i) cum.push(cum[i - 1] + metres(c[i - 1], c[i]));
      w = Math.min(w, c[i][0]); e = Math.max(e, c[i][0]); s = Math.min(s, c[i][1]); n = Math.max(n, c[i][1]);
    }
    return (geoCache[run.id] = { coords: c, cum: cum, total: cum[cum.length - 1], bounds: [[w, s], [e, n]] });
  }
  // The spot a fraction (0..1) of the way along the drawn route.
  function pointAt(g, f) {
    var want = Math.max(0, Math.min(1, f)) * g.total, lo = 0, hi = g.cum.length - 1;
    while (hi - lo > 1) { var mid = (lo + hi) >> 1; if (g.cum[mid] < want) lo = mid; else hi = mid; }
    var span = g.cum[hi] - g.cum[lo] || 1, k = (want - g.cum[lo]) / span;
    return [g.coords[lo][0] + (g.coords[hi][0] - g.coords[lo][0]) * k,
            g.coords[lo][1] + (g.coords[hi][1] - g.coords[lo][1]) * k];
  }
  // The other way round: how far along the route the point nearest `ll` is.
  function fractionNear(g, ll) {
    var best = 0, bestD = Infinity;
    for (var i = 0; i < g.coords.length; i++) {
      var dx = (g.coords[i][0] - ll.lng) * Math.cos(ll.lat * Math.PI / 180), dy = g.coords[i][1] - ll.lat;
      var d = dx * dx + dy * dy;
      if (d < bestD) { bestD = d; best = i; }
    }
    return g.total ? g.cum[best] / g.total : 0;
  }
  // Stream sample index for a fraction of the run's distance, and back.
  function sampleAt(run, f) {
    var d = run.d || [], n = d.length;
    if (!n) return -1;
    var want = f * (d[n - 1] || 0), lo = 0, hi = n - 1;
    while (hi - lo > 1) { var mid = (lo + hi) >> 1; if ((d[mid] || 0) < want) lo = mid; else hi = mid; }
    return Math.abs((d[hi] || 0) - want) < Math.abs((d[lo] || 0) - want) ? hi : lo;
  }
  function fractionOfSample(run, j) {
    var d = run.d || [], end = d[d.length - 1];
    return end && d[j] != null ? d[j] / end : 0;
  }

  /* ---------------- route styles ----------------
   * Strava calls these "stat maps": the line coloured by what you were doing
   * at that point. Heart rate uses the app's own zone colours so the map
   * matches the zone bars; pace is one hue, pale to deep, like any magnitude;
   * elevation uses the green-to-brown of a relief map.
   * ---------------------------------------------- */
  var ROUTE_STYLES = [
    { id: 'solid', name: 'Solid', hint: 'One clear line' },
    { id: 'glow', name: 'Glow', hint: 'Heat-map look, best on Satellite' },
    { id: 'hr', name: 'Heart rate', hint: 'Coloured by zone', stream: 'hs' },
    { id: 'pace', name: 'Pace', hint: 'Deeper blue is faster', stream: 'sp' },
    { id: 'elev', name: 'Elevation', hint: 'Green low, brown high', stream: 'al' }
  ];
  var ELEV_RAMP = ['#3f8f5a', '#a4b04c', '#d9a441', '#9a5b34'];
  function paceRamp() { return isDark() ? ['#2c3b78', '#8ea2ff', '#dfe5ff'] : ['#b9c6f5', '#4f6be0', '#1b2d86']; }
  function zoneInk(k) { return cssVar('--z-' + k) || '#888'; }

  function styleById(id) {
    for (var i = 0; i < ROUTE_STYLES.length; i++) if (ROUTE_STYLES[i].id === id) return ROUTE_STYLES[i];
    return ROUTE_STYLES[0];
  }
  function hasStream(run, key) {
    var a = run[key];
    return !!(a && a.length > 8 && run.d && run.d.length === a.length && a.some(function (v) { return v; }));
  }
  function stylesFor(run) {
    return ROUTE_STYLES.filter(function (s) { return !s.stream || hasStream(run, s.stream); });
  }
  function hexToRgb(h) { return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]; }
  function mix(stops, t) {
    t = Math.max(0, Math.min(1, t));
    var f = t * (stops.length - 1), i = Math.min(stops.length - 2, Math.floor(f)), k = f - i;
    var a = hexToRgb(stops[i]), b = hexToRgb(stops[i + 1]);
    return 'rgb(' + [0, 1, 2].map(function (c) { return Math.round(a[c] + (b[c] - a[c]) * k); }).join(',') + ')';
  }
  function rolling(vals, r) {
    return vals.map(function (_, i) {
      var s = 0, n = 0;
      for (var j = Math.max(0, i - r); j <= Math.min(vals.length - 1, i + r); j++) if (vals[j] != null) { s += vals[j]; n++; }
      return n ? s / n : null;
    });
  }
  function quantile(vals, q) {
    var v = vals.filter(function (x) { return x != null; }).sort(function (a, b) { return a - b; });
    return v.length ? v[Math.min(v.length - 1, Math.floor((v.length - 1) * q))] : null;
  }

  /*
   * A MapLibre `line-gradient` for a stream. Stops come straight from the
   * stream samples, placed at their share of the run's distance - which is
   * what `line-progress` measures along the drawn line, near enough.
   * Also returns what the legend needs.
   */
  function gradientFor(run, style) {
    var vals = run[style.stream], d = run.d, end = d[d.length - 1];
    if (!end) return null;
    var expr, legend, last = -1, stops = [];
    function push(f, c) {                               // stop inputs must strictly increase
      if (f <= last) f = last + 1e-6;
      if (f >= 1) return;
      last = f; stops.push(f, c);
    }
    if (style.id === 'hr') {
      var prev = null;
      for (var i = 0; i < vals.length; i++) {
        if (!vals[i]) continue;
        var z = zoneOf(vals[i]);
        if (z !== prev) { if (prev === null) stops.push(zoneInk(z)); else push(d[i] / end, zoneInk(z)); prev = z; }
      }
      if (!stops.length) return null;
      expr = ['step', ['line-progress']].concat(stops);
      legend = { kind: 'zones' };
    } else {
      var v = style.id === 'pace'
        ? rolling(vals.map(function (x) { return x > 40 ? x : null; }), 2)
        : rolling(vals, 1);
      var lo = quantile(v, 0.05), hi = quantile(v, 0.95);
      if (lo == null || hi == null || hi <= lo) return null;
      var ramp = style.id === 'pace' ? paceRamp() : ELEV_RAMP;
      for (var j = 0; j < v.length; j++) {
        if (v[j] == null || d[j] == null) continue;
        push(d[j] / end, mix(ramp, (v[j] - lo) / (hi - lo)));
      }
      if (stops.length < 4) return null;
      expr = ['interpolate', ['linear'], ['line-progress']].concat(stops);
      legend = style.id === 'pace'
        ? { kind: 'ramp', ramp: ramp, lo: pace(100000 / lo), hi: pace(100000 / hi), label: 'Pace' }
        : { kind: 'ramp', ramp: ramp, lo: Math.round(lo) + ' m', hi: Math.round(hi) + ' m', label: 'Height' };
    }
    return { expr: expr, legend: legend };
  }

  function widthBy(w) { return ['interpolate', ['linear'], ['zoom'], 9, w * 0.55, 14, w, 18, w * 1.7]; }
  var ROUTE_LAYERS = ['route-hit', 'route-case', 'route-glow1', 'route-glow2', 'route-line',
                      'route-km', 'route-km-label', 'route-ends', 'route-cursor'];

  function routeFeatures(run, g) {
    var feats = [], km = Math.floor(g.total / 1000);
    // a kilometre marker at every whole kilometre of the run's own distance
    for (var k = 1; k <= km && k < 100; k++) {
      var f = run.m ? k * 1000 / run.m : k * 1000 / g.total;
      if (f >= 0.995) break;
      feats.push({ type: 'Feature', properties: { kind: 'km', label: String(k) },
        geometry: { type: 'Point', coordinates: pointAt(g, f) } });
    }
    feats.push({ type: 'Feature', properties: { kind: 'end' }, geometry: { type: 'Point', coordinates: g.coords[g.coords.length - 1] } });
    feats.push({ type: 'Feature', properties: { kind: 'start' }, geometry: { type: 'Point', coordinates: g.coords[0] } });
    return { type: 'FeatureCollection', features: feats };
  }

  function drawRoute(map, run, styleId) {
    var g = routeGeo(run);
    ROUTE_LAYERS.forEach(function (id) { if (map.getLayer(id)) map.removeLayer(id); });
    if (!map.getSource('route')) {
      map.addSource('route', { type: 'geojson', lineMetrics: true,
        data: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: g.coords } } });
      map.addSource('route-pts', { type: 'geojson', data: routeFeatures(run, g) });
      map.addSource('cursor', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    }
    var style = styleById(styleId), grad = style.stream ? gradientFor(run, style) : null;
    if (style.stream && !grad) style = ROUTE_STYLES[0];
    var round = { 'line-join': 'round', 'line-cap': 'round' };
    var add = function (l) { map.addLayer(l); };
    // a wide invisible line, so a tap near the route counts as a tap on it
    add({ id: 'route-hit', type: 'line', source: 'route', layout: round,
      paint: { 'line-color': '#000', 'line-opacity': 0, 'line-width': 26 } });
    if (style.id === 'glow') {
      add({ id: 'route-glow1', type: 'line', source: 'route', layout: round,
        paint: { 'line-color': '#ff5a14', 'line-width': widthBy(20), 'line-blur': widthBy(14), 'line-opacity': 0.45 } });
      add({ id: 'route-glow2', type: 'line', source: 'route', layout: round,
        paint: { 'line-color': '#ff8a3d', 'line-width': widthBy(8), 'line-blur': widthBy(4), 'line-opacity': 0.85 } });
      add({ id: 'route-line', type: 'line', source: 'route', layout: round,
        paint: { 'line-color': '#fff4df', 'line-width': widthBy(2.6) } });
    } else {
      add({ id: 'route-case', type: 'line', source: 'route', layout: round,
        paint: { 'line-color': cssVar('--routecase') || '#fff', 'line-width': widthBy(8.5) } });
      var paint = { 'line-width': widthBy(5) };
      if (grad) paint['line-gradient'] = grad.expr; else paint['line-color'] = cssVar('--route') || '#ff4d2e';
      add({ id: 'route-line', type: 'line', source: 'route', layout: round, paint: paint });
    }
    add({ id: 'route-km', type: 'circle', source: 'route-pts', minzoom: 12.5, filter: ['==', ['get', 'kind'], 'km'],
      paint: { 'circle-radius': 8.5, 'circle-color': '#ffffff', 'circle-stroke-color': '#0e1a26', 'circle-stroke-width': 1.5 } });
    add({ id: 'route-km-label', type: 'symbol', source: 'route-pts', minzoom: 12.5, filter: ['==', ['get', 'kind'], 'km'],
      layout: { 'text-field': ['get', 'label'], 'text-font': LABEL_FONT, 'text-size': 10.5, 'text-allow-overlap': true,
                'text-ignore-placement': true },
      paint: { 'text-color': '#0e1a26' } });
    add({ id: 'route-ends', type: 'circle', source: 'route-pts', filter: ['!=', ['get', 'kind'], 'km'],
      paint: { 'circle-radius': 6.5,
               'circle-color': ['match', ['get', 'kind'], 'start', '#ffffff', '#0e1a26'],
               'circle-stroke-color': ['match', ['get', 'kind'], 'start', '#0e1a26', '#ffffff'],
               'circle-stroke-width': 3 } });
    add({ id: 'route-cursor', type: 'circle', source: 'cursor',
      paint: { 'circle-radius': 8, 'circle-color': cssVar('--accent') || '#2f4fd0',
               'circle-stroke-color': '#ffffff', 'circle-stroke-width': 3 } });
    return { style: style, legend: grad ? grad.legend : null };
  }

  function legendHTML(lg) {
    if (!lg) return '';
    if (lg.kind === 'zones') {
      return '<span class="lg-title">Heart rate</span>' + ['easy', 'moderate', 'threshold', 'hard'].map(function (k) {
        return '<span class="lg-item"><i style="background:' + zoneInk(k) + '"></i>' + conf.names[k] + '</span>';
      }).join('');
    }
    return '<span class="lg-title">' + lg.label + '</span><b>' + lg.lo + '</b><i class="lg-bar" style="background:' +
      'linear-gradient(90deg,' + lg.ramp.join(',') + ')"></i><b>' + lg.hi + '</b>';
  }

  /*
   * One run on a map. `opts.interactive` false gives the still preview on the
   * run page; true gives the full explorer. Returns a small controller.
   */
  function RunMap(el, run, opts) {
    opts = opts || {};
    var self = this;
    this.run = run; this.el = el; this.geo = routeGeo(run);
    this.basemap = opts.basemap || savedBasemap();
    this.styleId = opts.style || prefs.get('route', 'solid');
    if (!stylesFor(run).some(function (s) { return s.id === self.styleId; })) this.styleId = 'solid';
    this.three = !!opts.three;
    this.onPick = opts.onPick || null;
    this.onLegend = opts.onLegend || null;
    this.cursorF = null;
    this.ready = loadMapLibre().then(function (ml) {
      if (self.dead) return null;
      var g = self.geo;
      var map = self.map = new ml.Map({
        container: el, style: styleFor(self.basemap),
        bounds: g.bounds, fitBoundsOptions: { padding: opts.padding || 36 },
        interactive: opts.interactive !== false, attributionControl: { compact: true },
        maxPitch: self.three ? 78 : 0, fadeDuration: 150, dragRotate: true, pitchWithRotate: true,
        pixelRatio: Math.min(window.devicePixelRatio || 1, 2)
      });
      var loaded = false, fellBack = false;
      var fallBack = function () {
        if (loaded || fellBack) return;
        fellBack = true;
        map.setStyle(blankStyle(), { diff: false });
      };
      var timer = setTimeout(fallBack, 9000);                // no signal: don't wait forever
      map.on('error', function () { if (!loaded) fallBack(); });
      map.on('style.load', function () {
        loaded = true; clearTimeout(timer);
        tint(map, self.basemap);
        addGround(map, self.basemap);
        self.drawn = drawRoute(map, run, self.styleId);
        if (self.onLegend) self.onLegend(self.drawn);
        if (self.three) setGround3D(map, true);
        if (self.cursorF != null) self.showAt(self.cursorF);
        // Frame the route once, here rather than on 'load': 'load' waits for every
        // tile, which on a poor connection can be a long time or never.
        if (!self.placed) { self.placed = true; self.fit(false); }
        foldCredits();
      });
      // The map credits stay folded into their (i) button - MapLibre unfolds them
      // on every new basemap - unless you open them yourself.
      var openedCredits = false;
      var foldCredits = function () {
        var a = el.querySelector('.maplibregl-ctrl-attrib');
        if (a && !openedCredits) a.classList.remove('maplibregl-compact-show');
      };
      el.addEventListener('click', function (e) {
        if (e.target.closest('.maplibregl-ctrl-attrib-button')) openedCredits = !openedCredits;
      });
      map.on('sourcedata', function (e) { if (e.isSourceLoaded) foldCredits(); });
      map.on('click', function (e) {
        if (!self.onPick) return;
        var near = map.queryRenderedFeatures(e.point, { layers: ['route-hit'] });
        if (near.length) self.onPick(fractionNear(self.geo, e.lngLat));
      });
      return map;
    });
  }
  RunMap.prototype.setBasemap = function (id) {
    this.basemap = id;
    prefs.set('map', id);
    if (this.map) this.map.setStyle(styleFor(id), { diff: false });
  };
  RunMap.prototype.setStyle = function (id) {
    this.styleId = id;
    prefs.set('route', id);
    if (this.map && this.map.isStyleLoaded()) {
      this.drawn = drawRoute(this.map, this.run, id);
      if (this.onLegend) this.onLegend(this.drawn);
      if (this.cursorF != null) this.showAt(this.cursorF);
    }
  };
  /*
   * Frame the whole route. In 3D MapLibre's own tilted fit backs far off to
   * keep the near edge in view, leaving the route small; instead frame it as
   * if flat and tilt at that zoom, so the route stays big and the far end
   * simply recedes into the landscape.
   */
  RunMap.prototype.fit = function (animate, duration) {
    if (!this.map) return;
    var pad = this.el.clientWidth < 500 ? 36 : 70;
    var bearing = this.three ? -18 : 0;
    var cam = this.map.cameraForBounds(this.geo.bounds, { padding: { top: pad + 24, bottom: pad, left: pad, right: pad },
      pitch: 0, bearing: bearing });
    if (!cam) return;
    var to = { center: cam.center, zoom: cam.zoom + (this.three ? 0.2 : 0), bearing: bearing, pitch: this.three ? 60 : 0 };
    if (animate) this.map.easeTo(Object.assign(to, { duration: duration == null ? 900 : duration }));
    else this.map.jumpTo(to);
  };
  RunMap.prototype.set3D = function (on) {
    this.three = on;
    if (!this.map) return;
    setGround3D(this.map, on);
    if (on) this.map.easeTo({ pitch: 60, bearing: this.map.getBearing() || -18, duration: 900 });
    else this.map.easeTo({ pitch: 0, bearing: 0, duration: 700 });
    this.map.setMaxPitch(on ? 78 : 0);                 // flat means flat: no accidental tilting
  };
  // Put the marker a fraction of the way along the run, or remove it with null.
  RunMap.prototype.showAt = function (f) {
    this.cursorF = f;
    if (!this.map || !this.map.getSource('cursor')) return;
    this.map.getSource('cursor').setData({ type: 'FeatureCollection', features: f == null ? [] :
      [{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: pointAt(this.geo, f) } }] });
  };
  RunMap.prototype.destroy = function () {
    this.dead = true;
    if (this.map) { try { this.map.remove(); } catch (e) {} this.map = null; }
  };

  // The little icon set used on the map controls.
  var MICON = {
    close: '<path d="M6 6l12 12M18 6 6 18"/>',
    layers: '<path d="m12 3 9 5-9 5-9-5z"/><path d="m3 13 9 5 9-5"/>',
    line: '<path d="M4 18c3-8 6 2 9-6s5-4 7-6"/><circle cx="4" cy="18" r="1.6"/><circle cx="20" cy="6" r="1.6"/>',
    fit: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
    compass: '<path d="m12 3 3.5 9h-7z" fill="currentColor"/><path d="m12 21-3.5-9h7z"/>',
    expand: '<path d="M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7"/>'
  };
  function micon(name) {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" ' +
      'stroke-linejoin="round" aria-hidden="true">' + MICON[name] + '</svg>';
  }

  // A small menu that pops out of a map button. `items` = [{id, name, hint, on}].
  function menuHTML(kind, items) {
    return '<div class="mpop" data-menu="' + kind + '" hidden role="menu">' + items.map(function (it) {
      return '<button type="button" role="menuitemradio" data-' + kind + '="' + it.id + '"' +
        (it.on ? ' aria-checked="true" class="on"' : ' aria-checked="false"') + '>' +
        (it.swatch ? '<i class="sw" style="background:' + it.swatch + '"></i>' : '') +
        '<span><b>' + it.name + '</b>' + (it.hint ? '<small>' + it.hint + '</small>' : '') + '</span></button>';
    }).join('') + '</div>';
  }
  function styleSwatch(id) {
    if (id === 'hr') return 'linear-gradient(90deg,' + ['easy', 'moderate', 'threshold', 'hard'].map(zoneInk).join(',') + ')';
    if (id === 'pace') return 'linear-gradient(90deg,' + paceRamp().join(',') + ')';
    if (id === 'elev') return 'linear-gradient(90deg,' + ELEV_RAMP.join(',') + ')';
    if (id === 'glow') return 'linear-gradient(90deg,#ff5a14,#ffd9a8)';
    return cssVar('--route') || '#ff4d2e';
  }
