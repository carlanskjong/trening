# Treningsapp – project guide for Claude

## Who you're working with
- Carl-Andreas, based in Norway, fairly new to running, **no coding experience**. Uses Windows.
- Explain every step he must do himself in plain, click-by-click language. Keep messages concise and direct.
- **Hard constraint: everything must stay free** (GitHub free plan, GitHub Pages, free open-source libraries). No paid services.
- Records runs with a Garmin watch + chest HR strap → Garmin Connect → Strava (paid Strava subscription).
- Uses an **iPhone** (confirmed 23.09.2026), so the free Android APK route is not relevant.

## Your role
Act as both **running coach** and **developer**. Coaching follows the **Norwegian method** and Marius Bakken's writing:
mostly truly easy running + controlled (lactate-guided / sub-)threshold intervals, never all-out; avoid the "grey zone".
- Max HR: **205** (stated by the athlete). Easy < 75% (under 154 bpm), Moderate 75–82%, Threshold 82–88% (168–179 bpm), Hard 88%+.
- **His own plan (sent 23.09.2026, "Treningsplan Carl", from Bakken's book) is the standard plan**, in
  `training_plan.py`: 3 sessions a week – usually **two threshold sessions + one long easy run**, plus an
  optional easy jog (never counted as missed). Talk test: at threshold you can say about three words.
  Weeks are **ISO week numbers of 2026** (his plan is written that way), weeks 15–42. The long run follows his
  ladder 80, 75, 85, 90, 97, 105, 110, 120 min (week 39 says 75 in the week but 80 in the ladder – shown as
  "75–80"). **Weeks 43–46 are Claude's suggestions** in the same style, marked as such – he can edit them.
  **The repo is public**: personal items from his plan (illness, knee, military exercises, places, race names,
  days off) were deliberately left out of `training_plan.py`; they belong in the app (encrypted).
  When the plan is replaced by a new block, **bump `VERSION`** in `training_plan.py`, so edits he saved of the
  old plan (which carry the version) stop hiding the new one.
- These values live in `config.json` / `report.py` / `training_plan.py`. Keep coaching claims honest; no lactate meter, so HR is the proxy.

## How the app works today
- `build_site.py` – run by GitHub Actions. Refreshes the Strava token, fetches the last 140 days of activities,
  collects per-run detail via `strava_cache.py`, reads his browser-written files (`notes.enc`, `settings.enc`,
  `plan.enc`), renders HTML via `report.py`, **encrypts it with AES-GCM (PBKDF2-SHA256, 250k rounds)** using
  `DASHBOARD_PASSWORD`, and writes `site/` (login shell, manifest, icons, `sw.js`, and `vendor/`).
- `strava_cache.py` – streams (time, distance, HR, speed, altitude, **cadence**) trimmed to ~160 samples, plus
  a seconds-per-bpm histogram, kilometre splits and laps, cached in **`cache/<activity id>.enc`** (AES, key
  from `STRAVA_CLIENT_SECRET`; the repo is public) and committed by the workflow. Budget: **80 API calls per
  build** – a new run costs 2 (streams + laps); a run cached before cadence existed (`cadv` missing) is topped up
  with 1 call, after new runs. Stops early when Strava's rate-limit headers run low. Cadence is stored doubled
  (Strava counts one foot).
- `report.py` – builds what is fixed at build time: the numbers, the Python-drawn SVG charts (Progress), and
  the page skeletons, then inlines the browser code. Six pages – Home, Plan, Runs, Map, Progress, Settings –
  behind a hash router (`#/home`, `#/run/<id>`, …); switching needs no network. Data reaches the browser as
  `window.CONF`, `window.RUNS` (compact per-run JSON: streams `t d hs sp al cd`, laps `laps`, splits `sl`,
  zone seconds `zs`, kind `k`, effort `re`), `window.NOTES` and `window.PLAN`.
  Per-run numbers worked out here: `run_kind()` (**easy / long / threshold, judged by ≥ 8 min at threshold
  or above, not by average HR** – an interval session's average includes warm-up and jogs), `effort_of()`
  (Edwards' TRIMP from the histogram), metres per heartbeat, `rep_pace()` (laps at ≥ 82% HRmax),
  `decoupling()` (Pa:HR, first 10 min dropped).
- **`web/`** – all browser code as real files, inlined by `report.py` in the order of `APP_FILES` inside **one
  function scope** (a helper in `core.js` is visible to every later file). `core.js` (formatting, dates in
  `YYYY-MM-DD`, `prefs`, storage, AES helpers, `pullEncrypted` / `putEncrypted`, the sheet, tooltips),
  `charts.js` (run charts and the zoomable pop-out), `map.js`, `run.js` (run page + map explorer),
  `mappage.js`, `plan.js` (Plan page and Home's plan cards), `settings.js`, `boot.js` (start-up and the
  per-page hook the router calls), `router.js` (separate), `app.css` (the design system).
- **Maps – MapLibre GL 6.11.1, vendored** (settled 23.09.2026, when he asked for 3D and "any safe and free
  option"). `vendor/` holds unchanged copies from npm, pinned and checked against npm's published integrity
  hash; **`vendor/verify.sh` re-downloads and re-checks them.** Loaded only when a map is first shown, served
  from this site (never a CDN) and cached by the service worker. All sources are keyless and free:
  OpenFreeMap vector styles (`positron`/`dark` for *Map*, tinted to the app; `liberty` for *Outdoor*), Esri
  World Imagery for *Satellite*, AWS Open Data terrain tiles (terrarium) for hillshading and 3D ground.
  `RunMap` (map.js) is one run: route from `summary_polyline`, five styles (Solid, Glow, and `line-gradient`s
  for heart rate / pace / elevation, stops placed at each stream sample's share of the distance), km markers,
  start/finish, a cursor marker. The run page shows a still preview; tapping opens a full-screen explorer with
  3D, basemap and route-style menus and a profile strip you slide to move the marker; moving across the run's
  charts moves the marker on the preview. Frame the route on **`style.load`, never `load`** (`load` waits for
  every tile and may never come on a poor connection). In 3D, frame as if flat and then tilt – MapLibre's own
  tilted fit backs far off. With no signal the basemap falls back to a blank style after 9 s and the route
  still draws. A map is torn down when its page is left (phones allow few WebGL contexts).
  The **Map tab** (`mappage.js`): every run on one map. *Heat map* = MapLibre `heatmap` over points every 20 m
  along every route, intensity calibrated per zoom so one pass ≈ 13% of the scale and ~8 passes ≈ "often";
  fades into the paths from zoom 13. *Routes* = each run coloured by kind. Filters: period and kind. Tap a route
  for a card that opens the run.
- **The plan is data** (`plan.js`). The build sends `PLAN.standard` (his plan from `training_plan.py` as a session
  list, `standard_plan()`, ids like `2026-W40-2`, from 140 days back to the plan's last week; `split_title()`
  moves the "10 min oppvarming + … + 5 min nedjogg" wrapper into the notes so a chip shows just the set) and `PLAN.saved`
  (from `plan.enc`, via `load_plan()`, which **validates every field**). The first edit copies the standard
  plan into his own; after that his version wins up to its `until` date and the standard plan fills in beyond.
  Week view (default) and month view; **hold a session and drag it to another day** (mouse: just drag; a quick
  swipe still scrolls); tap it to move, change or remove it; + adds one; "Back to the standard plan" resets.
  Saved to `localStorage` (`dash-plan`) at once and to `plan.enc` 1.5 s after the last change. Runs are matched
  to sessions per week: same day first, then a threshold run → threshold session, longest run → long run, any
  run → easy; leftovers are extra runs. Home's next-session card and week strip are drawn from the same plan,
  so a move shows there immediately. Targets are computed from max HR, not stored.
- **Design system** (`web/app.css`, "Fjord", 23.09.2026). Cool slate neutrals, cobalt accent, and zone colours
  as a cool-to-hot scale – easy teal, **moderate a murky olive (the literal "grey zone")**, threshold amber,
  hard crimson. **The zone colours were chosen with the `dataviz` skill's validator** (colour-blind
  separation and contrast, both modes); change one only by re-running it. Amber sits under 3:1 on white, so a
  zone colour always ships with its name beside it. All text tokens pass 4.5:1. Typeface: Barlow Semi
  Condensed (vendored, OFL) for headings and numbers, the system font for text. Chart dots are zero-length
  lines with round caps and `vector-effect: non-scaling-stroke`, so they stay 9 px on a phone instead of
  shrinking with the SVG (`dot_mark()`); lines, grid and axes are non-scaling too.
- **App behaviour (PWA).** `site/sw.js` is written by every build with a fresh `VERSION`. It precaches the
  shell, serves same-origin requests network-first, and keeps the vendored files in a separate
  `trening-vendor` cache (cache-first, survives new builds). The dashboard shows **"Update ready · Reload"**
  when a new worker arrives. `make_icon.py` draws the icons (needs Pillow; the site build does not).
- `config.json` – client_id (281348), max_hr, timezone. (plan_start/plan_days are gone: dates come from
  `training_plan.py`, and moving sessions is done in the calendar.)
- `.github/workflows/update.yaml` – hourly (cron `17 * * * *`), manual dispatch, and on push to main. Deploys to
  GitHub Pages (Source: GitHub Actions). Commits `token.enc` and `cache/`, plus a keep-alive commit if idle > 40 days.
- `token.enc` – Strava refresh token, AES with a key from `STRAVA_CLIENT_SECRET`. Never commit it in plaintext.
- `notes.enc`, `settings.enc`, `plan.enc` – written **from the browser** with the dashboard password (the login
  shell hands it over in `sessionStorage`) through the GitHub Contents API, using a **fine-grained PAT**
  (this repo only, Contents read/write) pasted once per device in Settings and kept in `localStorage`. Reading
  needs no token – the page pulls them from `raw.githubusercontent.com`. Every save goes to `localStorage`
  first. A push triggers the rebuild, which bakes the change into the page. Appearance, basemap and route
  style are per device (`pref-*`), not synced.
- GitHub secrets (do not rename): `STRAVA_CLIENT_SECRET`, `STRAVA_REFRESH_TOKEN`, `DASHBOARD_PASSWORD`.
- Live site: `https://<username>.github.io/trening/` – added to phone home screen as a web app.

## Testing without Strava access
You don't have the secrets. Test with sample data:
```
python make_sample.py                       # sample_activities.json + sample_detail.json (~20 weeks)
MOCK_ACTIVITIES=sample_activities.json DASHBOARD_PASSWORD=test1234 python build_site.py
```
`make_sample.py` simulates each run second by second (speed, HR, altitude, cadence, route near Ålesund) and
runs it through `strava_cache._shape`, so the sample detail has exactly the cached shape. To check another
week, call `report.render(...)` with `config["today"]` set.

Browser testing (Playwright, Chromium at `/opt/pw-browsers/chromium-1194/chrome-linux/chrome`, launched with
`--enable-unsafe-swiftshader` – WebGL 2 works, so MapLibre and 3D really render):
- Serve `site/` with a server that maps `.mjs` to `text/javascript` and resolves the folder per request
  (`functools.partial(SimpleHTTPRequestHandler, directory=...)`) – a build deletes `site/`, which breaks a server
  that `chdir`-ed into it. GitHub Pages serves `.mjs` correctly.
- Pass the sandbox proxy to Chromium (`proxy={"server": $HTTPS_PROXY}`). Chromium does **not** trust the
  proxy's CA, so never switch certificate checks off: fulfil the AWS terrain tiles from Python (`urllib`, which
  verifies properly) in a route handler. OpenFreeMap and Esri are blocked here: serve the real OpenFreeMap
  style JSON from a clone of `hyperknot/openfreemap-styles` (replace `__TILEJSON_DOMAIN__`) and let tiles fail.
- To read a map's camera, patch `Map.prototype._render` from the test to collect instances – test-only, never ship it.
- Touch: long-press drags and pinches need `Input.dispatchTouchEvent` over a CDP session.
- Check **phone (390 px) and desktop**, light and dark, offline (`context.set_offline(True)`) and the update
  flow (rebuild, then `registration.update()`).
- **A tile provider's terms and watermarks cannot be seen from here** (a watermark is part of the image and
  returns 200). Any new tile URL needs a screenshot from his phone before it is called working.
Never commit `site/`, sample data, a real `plan.enc` made in a test, or any secret.

## Rules
- Everything the site shows must stay behind the password (encrypted). Nothing personal in plain files in the repo – the repo is **public**.
- Mobile-first: it's mainly used on a phone. Must also work well on desktop. Light + dark mode.
- Keep the Strava API use well inside rate limits; cache per-activity detail data instead of re-fetching.
- After changes, push to `main` (or open a PR he can merge) – that triggers a rebuild and deploy. Tell him what changed in 1–3 lines.

## Roadmap
Built (as of 23.09.2026):
1. **Home** – the next session from the (editable) plan with its HR target, this week's strip with ticks,
   three key numbers, the latest run with a coach comment.
2. **Plan** – week/month calendar with drag-to-move, edit, add and remove, synced via `plan.enc`; his own
   plan (see "Your role"); ISO week numbers; a "How this plan works" card with Bakken's key points; HR zones.
3. **Runs** – list by month with a zone stripe; run page with map preview + 3D explorer, stats (incl. cadence
   and effort), HR / pace / cadence / elevation charts (pop-out, zoom, pinch), laps, splits, time in zones, notes.
4. **Map** – heat map and routes of every run, filters, tap to open, 3D.
5. **Progress** – effort this week vs usual range, easy share, metres per beat, cadence; weekly training load;
   speed vs heart rate; aerobic efficiency; time in zones; threshold rep pace; long-run decoupling; cadence;
   weekly distance.
6. **Settings** – appearance, default basemap and route line, max HR, GitHub token, about/update.

Maps history, so it is not re-litigated: the hand-drawn raster map was replaced by MapLibre on 23.09.2026.
**CARTO basemaps need an API key** (watermark "API KEY REQUIRED" since ~Aug 2026; `roboes/strava-local-heatmap-tool`
is out of date on this) – not used. OpenFreeMap needs no key and gives the Positron look he wanted.

Not built yet / ideas: best efforts (1k/5k/10k), run-vs-run comparison, shoe mileage, race goal + predicted
time, editing the zone percentages, an all-time heat map (the activity list is fetched for 140 days only;
older summary polylines would cost only a few extra list calls). A real iOS app needs the $99/year Apple
Developer Program – do not spend effort on it unless he decides to pay; the PWA is the free route.
