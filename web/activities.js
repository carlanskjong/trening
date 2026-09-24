  /* ================================================================
   * Activities: everything from Strava, all the way back.
   *
   * Filter by sport and by year; the tiles add up what is shown. Rows are
   * drawn a batch at a time as you scroll, so years of history stay quick.
   * Each row carries a small drawing of the route (made at build time from
   * the route line, no map needed) and what the session was - judged by what
   * was done, not by the average heart rate.
   * ================================================================ */
  var actPage = (function () {
    var host = document.getElementById('actpage');
    if (!host) return null;
    var BATCH = 40;
    var state = { sport: prefs.get('actsport', 'all'), year: prefs.get('actyear', 'all') };
    var shown = [], drawn = 0, lastMonth = null, sentinel = null, watcher = null;

    function sportKey(a) { return RUN_TY[a.ty] ? 'run' : a.ty; }
    function sportsPresent() {
      var count = {};
      acts.forEach(function (a) { var k = sportKey(a); count[k] = (count[k] || 0) + 1; });
      return Object.keys(count).sort(function (a, b) { return a === 'run' ? -1 : b === 'run' ? 1 : count[b] - count[a]; });
    }
    function sportLabel(k) {
      return k === 'run' ? 'Runs' : k === 'all' ? 'All' : (conf.sports || {})[k] || k.replace(/([a-z])([A-Z])/g, '$1 $2');
    }
    function years() {
      var seen = {};
      acts.forEach(function (a) { seen[a.dt.slice(0, 4)] = 1; });
      return Object.keys(seen).sort().reverse();
    }
    function filtered() {
      return acts.filter(function (a) {
        return (state.sport === 'all' || sportKey(a) === state.sport) &&
          (state.year === 'all' || a.dt.slice(0, 4) === state.year);
      });
    }

    function thumbSVG(a) {
      if (!a.th) {
        return '<span class="athumb none" aria-hidden="true">' + esc(kindName(a).charAt(0)) + '</span>';
      }
      return '<svg class="athumb" viewBox="0 0 44 44" aria-hidden="true"><path d="' + a.th + '"/></svg>';
    }
    function numbers(a) {
      var out = [];
      if (a.m >= 100) out.push('<span><b>' + (a.m / 1000).toFixed(a.m >= 100000 ? 0 : 1) + '</b> km</span>');
      out.push('<span><b>' + (a.s >= 3600 ? Math.floor(a.s / 3600) + 'h ' + pad(Math.floor(a.s % 3600 / 60)) + 'm' : hms(a.s)) + '</b></span>');
      if (a.m >= 500 && a.s) {
        out.push(onFoot(a) ? '<span><b>' + pace(a.s / (a.m / 1000)) + '</b> /km</span>'
          : '<span><b>' + (a.m / a.s * 3.6).toFixed(1) + '</b> km/h</span>');
      }
      if (a.hr) out.push('<span><b>' + a.hr + '</b> bpm</span>');
      return out.join('');
    }
    function row(a) {
      var d = parseYmd(a.dt.slice(0, 10));
      var tag = kindName(a) + (a.rn ? ' · ' + a.rn + ' reps' : '');
      return '<a class="arow" href="#/run/' + a.id + '" style="--kc:' + kindColour(a) + '">' + thumbSVG(a) +
        '<span class="amain"><span class="atop"><span class="adate">' + DAYS_SHORT[weekdayOf(a.dt.slice(0, 10))] + ' ' +
        pad(d.getDate()) + '.' + pad(d.getMonth() + 1) + '</span><span class="akind"><i></i>' + esc(tag) + '</span>' +
        (tooHard(a) ? '<span class="pill warn small">grey zone</span>' : '') + '</span>' +
        '<b class="aname">' + esc(a.n) + '</b><span class="anums">' + numbers(a) + '</span></span></a>';
    }

    function more() {
      var list = host.querySelector('.alist');
      if (!list) return;
      var html = '', end = Math.min(shown.length, drawn + BATCH);
      for (; drawn < end; drawn++) {
        var a = shown[drawn], d = parseYmd(a.dt.slice(0, 10)), month = MONTHS[d.getMonth()] + ' ' + d.getFullYear();
        if (month !== lastMonth) {
          html += '<h3 class="month">' + month + '</h3>';
          lastMonth = month;
        }
        html += row(a);
      }
      sentinel.insertAdjacentHTML('beforebegin', html);
      sentinel.hidden = drawn >= shown.length;
    }

    function tiles(list) {
      var km = 0, secs = 0, climb = 0;
      list.forEach(function (a) { km += a.m / 1000; secs += a.s; climb += a.up || 0; });
      var what = state.sport === 'all' ? 'Activities' : sportLabel(state.sport);
      var when = state.year === 'all' ? 'all time' : state.year;
      return '<div class="tiles">' +
        '<div class="tile"><div class="label">' + esc(what) + '</div><div class="value">' + list.length + '</div>' +
        '<div class="note">' + when + '</div></div>' +
        '<div class="tile"><div class="label">Distance</div><div class="value">' + Math.round(km).toLocaleString('en-GB').replace(/,/g, ' ') +
        '<span class="unit">km</span></div><div class="note">' + Math.round(climb).toLocaleString('en-GB').replace(/,/g, ' ') + ' m climbed</div></div>' +
        '<div class="tile"><div class="label">Time</div><div class="value">' + Math.round(secs / 3600) +
        '<span class="unit">h</span></div><div class="note">moving time</div></div></div>';
    }

    function draw() {
      shown = filtered(); drawn = 0; lastMonth = null;
      var chips = '<div class="chiprow" role="group" aria-label="Sport">' +
        ['all'].concat(sportsPresent()).map(function (k) {
          return '<button type="button" data-sport="' + esc(k) + '" class="' + (state.sport === k ? 'on' : '') + '">' +
            esc(sportLabel(k)) + '</button>';
        }).join('') + '</div><div class="chiprow" role="group" aria-label="Year">' +
        ['all'].concat(years()).map(function (y) {
          return '<button type="button" data-year="' + y + '" class="' + (state.year === y ? 'on' : '') + '">' +
            (y === 'all' ? 'All years' : y) + '</button>';
        }).join('') + '</div>';
      host.innerHTML = chips + tiles(shown) + '<section class="card"><div class="alist">' +
        (shown.length ? '' : '<p class="sub">Nothing here with these filters.</p>') +
        '<div class="asentinel"><button type="button" class="btn small ghost" data-more="1">Show more</button></div>' +
        '</div></section>';
      sentinel = host.querySelector('.asentinel');
      if (watcher) watcher.disconnect();
      if (window.IntersectionObserver) {
        watcher = new IntersectionObserver(function (en) { if (en[0].isIntersecting) more(); }, { rootMargin: '600px' });
        watcher.observe(sentinel);
      }
      more();
    }

    host.addEventListener('click', function (e) {
      var b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.sport) { state.sport = b.dataset.sport; prefs.set('actsport', state.sport); draw(); }
      else if (b.dataset.year) { state.year = b.dataset.year; prefs.set('actyear', state.year); draw(); }
      else if (b.dataset.more) more();
    });
    // a remembered filter for a sport or year that no longer has anything
    if (state.sport !== 'all' && sportsPresent().indexOf(state.sport) < 0) state.sport = 'all';
    if (state.year !== 'all' && years().indexOf(state.year) < 0) state.year = 'all';
    draw();
    return { draw: draw };
  })();
