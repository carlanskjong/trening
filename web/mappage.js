  /* ================================================================
   * The Map tab: every run on one map.
   *
   * Heat   a density heat map of where you run, built from points laid every
   *        20 m along every route - bright where many runs overlap, faint
   *        where you have been once. Close in, the heat thins out into the
   *        paths themselves so the roads stay sharp.
   * Routes every run as its own line, coloured by the kind of session.
   * Tap any route (in either view) to see which run it was and open it.
   * ================================================================ */
  // What a route is coloured by on the Routes view: the session for runs, the sport otherwise.
  function groupOf(a) {
    if (a.k) return a.k === 'threshold' ? 'threshold' : a.k === 'race' ? 'race' : 'easy';
    return a.ty === 'Hike' || a.ty === 'Walk' ? 'foot' : /Ride/.test(a.ty) ? 'ride' : 'other';
  }
  var GROUP_INK = { easy: '--z-easy', threshold: '--z-threshold', race: '--z-hard', foot: '--c-elev', ride: '--bar', other: '--bar' };
  var GROUP_NAME = { easy: 'Easy & long', threshold: 'Threshold', race: 'Race', foot: 'Hikes & walks', ride: 'Rides', other: 'Other' };

  var mapPage = window.mapPage = (function () {
    var el = document.getElementById('mappage');
    if (!el) return null;
    var state = {
      mode: prefs.get('mapmode', 'heat'), period: prefs.get('mapperiod', 'all'), kind: prefs.get('mapkind', 'runs'),
      basemap: null, three: false
    };
    var map = null, loading = null, shown = [], selected = null;

    function chosen() {
      var cut = state.period === 'all' ? '' : addDays(TODAY, -(+state.period));
      return acts.filter(function (r) {
        if (!r.poly || (cut && r.dt.slice(0, 10) < cut)) return false;
        var k = state.kind, g = groupOf(r);
        var fits = k === 'all' || (k === 'runs' ? isRun(r) : k === 'foot' || k === 'ride' ? g === k : r.k === k);
        return fits && routeGeo(r);
      });
    }

    // Points every ~20 m along a route, for the density layer.
    // Points every ~20 m along a route; further apart when years of routes would
    // otherwise make hundreds of thousands of them (phones slow down).
    var pointCache = {};
    function pointsOf(r, step) {
      var key = r.id + ':' + step;
      if (pointCache[key]) return pointCache[key];
      var g = routeGeo(r), out = [];
      for (var i = 1; i < g.coords.length; i++) {
        var seg = g.cum[i] - g.cum[i - 1], a = g.coords[i - 1], b = g.coords[i];
        var n = Math.max(1, Math.round(seg / step));
        for (var k = 0; k < n; k++) out.push([a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n]);
      }
      return (pointCache[key] = out);
    }

    function data() {
      shown = chosen();
      var lines = [], pts = [], total = 0;
      shown.forEach(function (r) { total += routeGeo(r).total; });
      var step = Math.max(20, Math.round(total / 180000 / 10) * 10);
      shown.forEach(function (r) {
        lines.push({ type: 'Feature', id: r.id, properties: { id: r.id, kind: groupOf(r) },
          geometry: { type: 'LineString', coordinates: routeGeo(r).coords } });
        pointsOf(r, step).forEach(function (c) { pts.push({ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: c } }); });
      });
      return { lines: { type: 'FeatureCollection', features: lines }, pts: { type: 'FeatureCollection', features: pts } };
    }

    function darkGround() { return state.basemap === 'satellite' || (state.basemap === 'map' && isDark()); }
    // On a dark ground heat glows from deep red up to near white; on a light
    // ground it darkens instead, so the busiest paths always stand out most.
    function heatRamp() {
      return darkGround()
        ? ['rgba(122,16,48,0)', 'rgba(150,20,60,0.55)', '#d7263d', '#f08a2c', '#ffd27a', '#fff6e0']
        : ['rgba(253,224,197,0)', 'rgba(250,196,150,0.6)', '#f08a2c', '#d7263d', '#8e0f3a', '#4a0624'];
    }

    function addLayers() {
      var d = data();
      map.addSource('all-lines', { type: 'geojson', data: d.lines });
      map.addSource('all-pts', { type: 'geojson', data: d.pts });
      var ramp = heatRamp();
      /*
       * Calibrated so one run over a path lands near 13% of the scale at every
       * zoom, and about eight runs over the same path reach "often". The
       * intensity has to fall as you zoom out because more of the 20 m points
       * then fit inside the blur radius: roughly 70 per run at zoom 8, 3-4 at 15.
       */
      map.addLayer({ id: 'heat', type: 'heatmap', source: 'all-pts', maxzoom: 17, paint: {
        'heatmap-weight': 1,
        'heatmap-intensity': ['interpolate', ['exponential', 1.5], ['zoom'],
          8, 0.005, 10, 0.0105, 12, 0.026, 13, 0.04, 15, 0.095, 17, 0.19],
        'heatmap-radius': ['interpolate', ['exponential', 1.6], ['zoom'], 8, 2.5, 12, 7, 15, 16, 17, 28],
        'heatmap-color': ['interpolate', ['linear'], ['heatmap-density'],
          0, ramp[0], 0.08, ramp[1], 0.3, ramp[2], 0.55, ramp[3], 0.8, ramp[4], 1, ramp[5]],
        'heatmap-opacity': ['interpolate', ['linear'], ['zoom'], 13, 0.95, 16, 0.35]
      } });
      // close in, the heat hands over to the paths themselves
      map.addLayer({ id: 'heat-lines', type: 'line', source: 'all-lines', minzoom: 13,
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: { 'line-color': ramp[3], 'line-width': 2, 'line-opacity': ['interpolate', ['linear'], ['zoom'], 13, 0, 15, 0.55] } });
      map.addLayer({ id: 'routes', type: 'line', source: 'all-lines',
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: {
          'line-color': ['match', ['get', 'kind']].concat([].concat.apply([], Object.keys(GROUP_INK).map(function (k) {
            return [k, cssVar(GROUP_INK[k]) || '#888'];
          })), ['#888']),
          'line-width': ['interpolate', ['linear'], ['zoom'], 9, 1.6, 14, 3.2],
          'line-opacity': ['case', ['boolean', ['feature-state', 'dim'], false], 0.18, 0.8]
        } });
      map.addLayer({ id: 'routes-hit', type: 'line', source: 'all-lines',
        paint: { 'line-color': '#000', 'line-opacity': 0, 'line-width': 22 } });
      map.addLayer({ id: 'picked', type: 'line', source: 'all-lines', filter: ['==', ['get', 'id'], -1],
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: { 'line-color': cssVar('--routecase') || '#fff', 'line-width': 8 } });
      map.addLayer({ id: 'picked-top', type: 'line', source: 'all-lines', filter: ['==', ['get', 'id'], -1],
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: { 'line-color': cssVar('--route') || '#ff4d2e', 'line-width': 4.5 } });
      applyMode();
      if (selected) pick(selected, false);
    }

    function applyMode() {
      if (!map) return;
      var heat = state.mode === 'heat';
      ['heat', 'heat-lines'].forEach(function (id) { if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', heat ? 'visible' : 'none'); });
      if (map.getLayer('routes')) map.setLayoutProperty('routes', 'visibility', heat ? 'none' : 'visible');
      legend();
    }

    function refreshData() {
      if (!map || !map.getSource('all-lines')) return;
      var d = data();
      map.getSource('all-lines').setData(d.lines);
      map.getSource('all-pts').setData(d.pts);
      if (selected && !shown.some(function (r) { return r.id === selected; })) unpick();
      stats();
    }

    function boundsOf(list) {
      var w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
      list.forEach(function (r) {
        var b = routeGeo(r).bounds;
        w = Math.min(w, b[0][0]); s = Math.min(s, b[0][1]); e = Math.max(e, b[1][0]); n = Math.max(n, b[1][1]);
      });
      return isFinite(w) ? [[w, s], [e, n]] : null;
    }
    // Frame where most running happens: the middle 90% of runs, so a single
    // run on holiday does not shrink home to a dot.
    function homeBounds(list) {
      if (list.length < 6) return boundsOf(list);
      var mid = function (r) { var b = routeGeo(r).bounds; return [(b[0][0] + b[1][0]) / 2, (b[0][1] + b[1][1]) / 2]; };
      var xs = list.map(function (r) { return mid(r)[0]; }).sort(function (a, b) { return a - b; });
      var ys = list.map(function (r) { return mid(r)[1]; }).sort(function (a, b) { return a - b; });
      var q = function (a, f) { return a[Math.floor((a.length - 1) * f)]; };
      var cx = q(xs, 0.5), cy = q(ys, 0.5), dx = Math.max(q(xs, 0.95) - q(xs, 0.05), 0.01), dy = Math.max(q(ys, 0.95) - q(ys, 0.05), 0.01);
      var near = list.filter(function (r) { var m = mid(r); return Math.abs(m[0] - cx) <= dx && Math.abs(m[1] - cy) <= dy; });
      return boundsOf(near.length ? near : list);
    }
    function fit(animate) {
      var b = homeBounds(shown.length ? shown : runs.filter(routeGeo));
      if (!map || !b) return;
      var cam = map.cameraForBounds(b, { padding: { top: 130, bottom: 90, left: 30, right: 70 }, pitch: 0, bearing: state.three ? -18 : 0 });
      if (!cam) return;
      var to = { center: cam.center, zoom: cam.zoom + (state.three ? 0.2 : 0), pitch: state.three ? 60 : 0, bearing: state.three ? -18 : 0 };
      if (animate) map.easeTo(Object.assign(to, { duration: 800 })); else map.jumpTo(to);
    }

    function stats() {
      var km = shown.reduce(function (a, r) { return a + r.m; }, 0) / 1000;
      el.querySelector('.mp-stats').textContent = shown.length
        ? shown.length + ' activit' + (shown.length === 1 ? 'y' : 'ies') + ' · ' + Math.round(km).toLocaleString('en-GB').replace(/,/g, ' ') + ' km'
        : 'Nothing with a route in this period';
    }
    function legend() {
      var lg = el.querySelector('.mlegend');
      if (state.mode === 'heat') {
        lg.innerHTML = '<span class="lg-title">Heat</span><b>Once</b><i class="lg-bar" style="background:linear-gradient(90deg,' +
          heatRamp().slice(1).join(',') + ')"></i><b>Often</b>';
      } else {
        var present = {};
        shown.forEach(function (r) { present[groupOf(r)] = 1; });
        lg.innerHTML = Object.keys(GROUP_INK).filter(function (k) { return present[k]; }).map(function (k) {
          return '<span class="lg-item"><i style="background:' + cssVar(GROUP_INK[k]) + '"></i>' + GROUP_NAME[k] + '</span>';
        }).join('');
      }
      lg.hidden = false;
    }

    function unpick() {
      selected = null;
      el.querySelector('.mp-card').hidden = true;
      if (map && map.getLayer('picked')) {
        map.setFilter('picked', ['==', ['get', 'id'], -1]);
        map.setFilter('picked-top', ['==', ['get', 'id'], -1]);
      }
    }
    function pick(id, animate) {
      var r = byId[id];
      if (!r) return;
      selected = id;
      map.setFilter('picked', ['==', ['get', 'id'], id]);
      map.setFilter('picked-top', ['==', ['get', 'id'], id]);
      var card = el.querySelector('.mp-card');
      card.style.setProperty('--zc', kindColour(r));
      card.innerHTML = '<div class="mpc-body"><span class="typechip"><i></i>' + esc(kindName(r)) + '</span>' +
        '<b>' + esc(r.n) + '</b><span class="mpc-when">' + dateText(r.dt).split(' · ')[0] + '</span>' +
        '<span class="mpc-nums"><span><b>' + (r.m / 1000).toFixed(1) + '</b> km</span><span><b>' +
        (onFoot(r) ? pace(r.s / (r.m / 1000)) + '</b> /km' : (r.m / r.s * 3.6).toFixed(1) + '</b> km/h') + '</span>' +
        (r.hr ? '<span><b>' + r.hr + '</b> bpm</span>' : '') + '</span></div>' +
        '<div class="mpc-act"><a class="btn small" href="#/run/' + r.id + '">Open</a>' +
        '<button type="button" class="mbtn small" data-act="unpick" aria-label="Close">' + micon('close') + '</button></div>';
      card.hidden = false;
      if (animate) {
        var b = routeGeo(r).bounds;
        map.fitBounds(b, { padding: { top: 140, bottom: 190, left: 40, right: 80 }, maxZoom: 15,
          pitch: map.getPitch(), bearing: map.getBearing(), duration: 700 });
      }
    }

    function markChoices() {
      el.querySelectorAll('[data-mode]').forEach(function (b) { b.classList.toggle('on', b.dataset.mode === state.mode); });
      el.querySelectorAll('[data-period]').forEach(function (b) { b.classList.toggle('on', b.dataset.period === state.period); });
      el.querySelectorAll('[data-kind]').forEach(function (b) { b.classList.toggle('on', b.dataset.kind === state.kind); });
      el.querySelectorAll('[data-basemap]').forEach(function (b) {
        var on = b.dataset.basemap === state.basemap;
        b.classList.toggle('on', on); b.setAttribute('aria-checked', on ? 'true' : 'false');
      });
      var t = el.querySelector('[data-act="3d"]');
      t.classList.toggle('on', state.three); t.setAttribute('aria-pressed', state.three ? 'true' : 'false');
    }

    function build() {
      if (map || loading) return loading;
      state.basemap = state.basemap || prefs.get('heatmap-base', '') || 'map';
      markChoices();
      var box = el.querySelector('.mp-map');
      loading = loadMapLibre().then(function (ml) {
        if (!el.closest('.page').classList.contains('on')) { loading = null; return; }
        shown = chosen();
        map = new ml.Map({
          container: box, style: styleFor(state.basemap), bounds: homeBounds(shown.length ? shown : runs.filter(routeGeo)) || undefined,
          fitBoundsOptions: { padding: 40 }, attributionControl: { compact: true }, maxPitch: 72,
          pixelRatio: MAP_PIXELS.pixelRatio, maxCanvasSize: MAP_PIXELS.maxCanvasSize, fadeDuration: 150
        });
        var loaded = false, fell = false, placed = false;
        var timer = setTimeout(function () { if (!loaded && !fell) { fell = true; map.setStyle(blankStyle(), { diff: false }); } }, 9000);
        map.on('error', function () { if (!loaded && !fell) { fell = true; map.setStyle(blankStyle(), { diff: false }); } });
        map.on('style.load', function () {
          loaded = true; clearTimeout(timer);
          tint(map, state.basemap);
          addGround(map, state.basemap);
          addLayers();
          if (state.three) setGround3D(map, true);
          if (!placed) { placed = true; fit(false); }
          stats();
        });
        keepCreditsFolded(map, box);
        autoThree(map, function () { return state.three; }, function (on) { state.three = on; markChoices(); });
        map.on('click', function (e) {
          var hit = map.queryRenderedFeatures([[e.point.x - 10, e.point.y - 10], [e.point.x + 10, e.point.y + 10]], { layers: ['routes-hit'] });
          if (hit.length) pick(hit[0].properties.id, false); else unpick();
        });
        map.on('mousemove', function (e) {
          var hit = map.queryRenderedFeatures(e.point, { layers: ['routes-hit'] });
          map.getCanvas().style.cursor = hit.length ? 'pointer' : '';
        });
        loading = null;
      }).catch(function () {
        loading = null;
        box.innerHTML = '<p class="mv-fail">The map could not load. Check your connection and open it again.</p>';
      });
      return loading;
    }

    el.addEventListener('click', function (e) {
      var b = e.target.closest('button');
      var menu = el.querySelector('[data-menu="basemap"]');
      if (!b) { if (!e.target.closest('.mpop')) menu.hidden = true; return; }
      if (b.dataset.mode) {
        state.mode = b.dataset.mode; prefs.set('mapmode', state.mode); applyMode(); markChoices(); return;
      }
      if (b.dataset.period) {
        state.period = b.dataset.period; prefs.set('mapperiod', state.period); markChoices(); refreshData(); fit(true); return;
      }
      if (b.dataset.kind) { state.kind = b.dataset.kind; prefs.set('mapkind', state.kind); markChoices(); refreshData(); fit(true); return; }
      if (b.dataset.basemap) {
        state.basemap = b.dataset.basemap; prefs.set('heatmap-base', state.basemap); menu.hidden = true; markChoices();
        if (map) map.setStyle(styleFor(state.basemap), { diff: false });
        return;
      }
      var act = b.dataset.act;
      if (act === 'basemap') { menu.hidden = !menu.hidden; return; }
      menu.hidden = true;
      if (act === 'unpick') unpick();
      else if (act === 'fit') fit(true);
      else if (act === '3d' && map) {
        state.three = !state.three; markChoices();
        setGround3D(map, state.three);
        map.easeTo({ pitch: state.three ? 60 : 0, bearing: state.three ? (map.getBearing() || -18) : 0, duration: 800 });
      }
    });

    return {
      show: function () {
        build();
        if (map) setTimeout(function () { map.resize(); }, 0);
        // the whole history's routes, once per visit
        loadRoutes().then(function () { if (map) { refreshData(); if (!selected) fit(true); } }).catch(function () {});
      },
      hide: function () {
        if (!map) return;
        try { map.remove(); } catch (e) {}
        map = null;
        el.querySelector('.mp-map').innerHTML = '';
      }
    };
  })();
