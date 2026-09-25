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
- `build_site.py` – run by GitHub Actions. Refreshes the Strava token, gets **the whole activity history,
  every sport** (`strava_cache.activity_list`), collects per-activity detail (`strava_cache.collect`), reads his
  browser-written files (`notes.enc`, `settings.enc`, `plan.enc`), renders via `report.render_site`, **encrypts
  the page with AES-GCM (PBKDF2-SHA256, 250k rounds)** using `DASHBOARD_PASSWORD`, and writes `site/` (login
  shell, manifest, icons, `sw.js`, `vendor/`) plus **side files**: `a/<id>.bin` (detail of each activity older
  than 140 days) and `routes.bin` (every route). Side files are `IV + AES-GCM(JSON)` under one key per password
  (`side_key()`: PBKDF2 with a salt derived from the password, so a cached side file stays readable next to a
  newer page); the browser derives it once per visit (`sideKey()` in core.js).
- `strava_cache.py` – **history import (24.09.2026, he asked for all old runs/hikes)**:
  `cache/activities.enc` holds the full activity list (trimmed fields); each build asks only for the last 35
  days again (1 call; edits and deletions in that window show), a full re-read once a week; if Strava fails,
  the cached list is used so the site still builds. Per activity, `cache/<id>.enc` holds streams (time,
  distance, HR, speed, altitude, cadence) trimmed to ~160 samples, a seconds-per-bpm histogram, km splits,
  and – from the **activity endpoint** (`/activities/{id}`, which also carries the laps) – best efforts with PR
  rank, shoe, calories, device, temperature and description. A new activity costs 2 calls (streams +
  activity); older cache entries without `detv`/`cadv` are topped up with 1 call each. Order: last 140 days
  first, then history newest first. **Budget 80 calls per build, and it stops when any window (15-min or daily,
  overall or read – `X-ReadRateLimit-*` too) has fewer than 30 left** – Strava's personal-app read limit is
  1,000/day, so a large history arrives over a day or two. Cadence is doubled only on foot (Strava counts one
  foot; bike cadence is rpm). Manual entries are skipped. Tested against a fake Strava (list paging,
  incremental merge, deletion, weekly re-read, offline fallback, budget, reserve).
- `analysis.py` – the meaning of the numbers: `detect_reps` (work intervals from the watch laps – the widest
  pace gap splits work from rest, auto 1 km laps ignored – else from the pace stream for reps ≥ 2 min),
  `rep_stats`, `run_kind` (**threshold / easy / long / race, from time at threshold HR, detected reps, Strava's
  workout/race flag or the name – never from average HR**), `coach_verdict` (threshold judged by rep HR, the
  last third of the reps when reps are short because HR lags; easy/long by average HR), GAP (Minetti slope
  cost, clamped), `pace_targets` (threshold window from reps ≥ 2 min at threshold HR in the last 6 weeks, easy
  window from easy runs under the ceiling), `fitness_series` (CTL 42 d / ATL 7 d / form), `route_groups`
  (same route: distance within 8 %, starts within 250 m, lines ≤ 90 m apart on average), `predict` (Riegel).
- `report.py` – builds what is fixed at build time: the numbers and the page skeletons, then inlines the
  browser code. It draws **no charts** – Progress gets empty `.pc` slots (`chart_slot()`) plus the numbers
  as `window.PROG` (`progress_payload()`; tooltip texts `Title|line|line`, already HTML-escaped). Six pages – Home, Plan, Runs, Map, Progress, Settings –
  behind a hash router (`#/home`, `#/run/<id>`, …); switching needs no network. Data reaches the browser as
  `window.CONF` (incl. `targets`, `race`, `side`, `sports`), `window.ACTS` (**every activity**, compact:
  `id n ty dt m s e up hr mhr cad z k re th rg g rn`; `th` = SVG path of the route thumbnail, `rg` = same-route
  group, `rn` = rep count; the last 140 days also carry `t d hs sp al cd laps sl zs poly reps rs be gap coach …`,
  older ones have `x:1` and load that from `a/<id>.bin` via `loadDetail()`), `window.NOTES` (`{text, rpe,
  updated}` per activity), `window.PLAN` and `window.PROG` (Progress data incl. `fit`, `ytd`, `best`, `shoes`).
  In core.js `acts` is everything and `runs` the runs.
  Per-run numbers worked out here: `run_kind()` (**easy / long / threshold, judged by ≥ 8 min at threshold
  or above, not by average HR** – an interval session's average includes warm-up and jogs), `effort_of()`
  (Edwards' TRIMP from the histogram), metres per heartbeat, `rep_pace()` (laps at ≥ 82% HRmax),
  `decoupling()` (Pa:HR, first 10 min dropped).
- **`web/`** – all browser code as real files, inlined by `report.py` in the order of `APP_FILES` inside **one
  function scope** (a helper in `core.js` is visible to every later file). `core.js` (formatting, dates in
  `YYYY-MM-DD`, `prefs`, storage, AES helpers, `pullEncrypted` / `putEncrypted`, the sheet), `charts.js`
  (the chart engine and a run's charts), `map.js`, `run.js` (run page + map explorer), `mappage.js`,
  `activities.js` (the Activities list: sport and year chips, totals, route thumbnails, rows drawn 40 at a time
  as you scroll), `progress.js` (the Progress charts and the training log), `plan.js` (Plan page and Home's plan cards), `settings.js`, `boot.js`
  (start-up and the per-page hook the router calls), `router.js` (separate), `app.css` (the design system).
- **Charts (rebuilt 24.09.2026)** – all drawn in the browser by one small engine in `charts.js`, **at the
  pixel size they are shown** (SVG width = box width, redrawn by a ResizeObserver), so text is real 11.5 px
  and dots are real dots. The old way – a 760-wide drawing scaled down to a phone – made labels ~5 px and was
  what he called hard to read; do not go back to it. A chart is a `spec` (x/y axes, `layers`: hbands, vbands,
  line (+area), dots, cols, guide; `tips` for tooltips) drawn by a `Plot` for a `view`; zoom only changes the
  view. `hands()` wires gestures on a transparent overlay that is never redrawn (a pinch survives redraws):
  **tap = open full screen** (`openChartWindow`); one finger reads (crosshair + readout on run charts, which
  also moves the map marker; nearest-point tooltip on Progress); **two fingers pinch/drag to zoom and move;
  double-tap resets**; mouse: hover reads, wheel/trackpad pinch zooms, drag moves, double-click resets.
  No zoom buttons and no "Bigger" buttons – he asked for both to go. Inline Progress charts ignore a resting
  finger (`touchRead: false`) so scrolling does not flash tooltips.
  Run charts are against **distance** (km ticks), y refits to what is in view: heart rate over zone washes
  with the zone edges as ticks, pace inverted, **cadence as dots coloured red → amber → green**
  (`cadColour`, `CAD_LOW` 160 / `CAD_GOOD` 170, legend beside it; same colours on Progress' cadence),
  elevation as an area. Chart inks are tokens: `--c-hr`, `--c-elev`, `--c-mid`, `--bar`, `--zwash`.
- **Maps – MapLibre GL 6.11.1, vendored** (settled 23.09.2026, when he asked for 3D and "any safe and free
  option"). `vendor/` holds unchanged copies from npm, pinned and checked against npm's published integrity
  hash; **`vendor/verify.sh` re-downloads and re-checks them.** Loaded only when a map is first shown, served
  from this site (never a CDN) and cached by the service worker. All sources are keyless and free:
  OpenFreeMap vector styles (`positron`/`dark` for *Map*, tinted to the app; `liberty` for *Outdoor*), Esri
  World Imagery for *Satellite*, AWS Open Data terrain tiles (terrarium) for hillshading and 3D ground.
  `RunMap` (map.js) is one run: route from `summary_polyline`, five styles (Solid, Glow, and `line-gradient`s
  for heart rate / pace / elevation, stops placed at each stream sample's share of the distance), km markers,
  start/finish, a cursor marker. The run page shows a still preview (only a 3D shortcut and the legend on it);
  tapping it opens a full-screen explorer with 3D, basemap and route-style menus and a profile strip you slide
  to move the marker. **Tilting with two fingers switches 3D on by itself, laying it flat switches it off**
  (`autoThree()`, used by the explorer and the Map tab; only user gestures count, via `originalEvent` on
  `movestart`, so the 3D button's own camera moves do not flip it; max pitch 72°); moving across the run's
  charts moves the marker on the preview. Frame the route on **`style.load`, never `load`** (`load` waits for
  every tile and may never come on a poor connection). In 3D, frame as if flat and then tilt – MapLibre's own
  tilted fit backs far off. With no signal the basemap falls back to a blank style after 9 s and the route
  still draws. A map is torn down when its page is left (phones allow few WebGL contexts).
  **Every map is drawn at `pixelRatio: 2` whatever the screen** (`MAP_PIXELS` in map.js, with `maxCanvasSize`
  8192): MapLibre renders the heat map into a buffer 1/4 of the canvas wide and high, so on a 1× PC screen it was
  1/4 of screen resolution and looked blocky (he saw it on the web version, not the phone). Measured 25.09.2026 at
  1280/1920 wide × scaling 1/1.25/2: the canvas always matched its box (MapLibre 6 has its own ResizeObserver),
  so it was the resolution, not stretching.
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
  Condensed (vendored, OFL) for headings and numbers, the system font for text.
- **App behaviour (PWA).** `site/sw.js` is written by every build with a fresh `VERSION`. It precaches the
  shell, serves same-origin requests network-first, and keeps the vendored files in a separate
  `trening-vendor` cache (cache-first, survives new builds). The dashboard shows **"Update ready · Reload"**
  when a new worker arrives. `make_icon.py` draws the icons (needs Pillow; the site build does not).
- **Run page** (`run.js`), top to bottom: header (session type + reps, grey-zone warning, the planned session),
  map + stats (GAP, kcal, temperature, shoe, device), **Coach** (the verdict + **planned vs done**: `planCheck()`
  in plan.js finds the matched session and `parsePlan()` reads his plan text – "5×6 min", "20×1 min",
  "10×(45/15)", "2×(8×(45/15))", ladders "(7–6–5–4–3–2–1 min)", "15 min sammenhengende terskel", "75–80 min" –
  into reps/work/minutes), charts, **Reps** (chart + table, laps folded), splits with GAP, zone bars, best
  efforts with PR medals, **This route** (pace on every run of the route), **Compare** (any similar activity:
  table + dashed overlay), and **How did it feel** (1–10 + notes). **His notation (24.09.2026): a bare number
  before or after a "+" is warm-up / cool-down minutes – "10 + 5×(45/15) + 5" is 5 reps.** Both `parsePlan()`
  and `split_title()` follow it.
- **Home**: next session with **heart rate and pace targets**, the week with a progress ring, race goal card
  (countdown + Riegel prediction, from Settings), tiles, latest run judged by type, **last week in review**.
- `config.json` – client_id (281348), max_hr, timezone. (plan_start/plan_days are gone: dates come from
  `training_plan.py`, and moving sessions is done in the calendar.)
- `.github/workflows/update.yaml` – cron `17 * * * *` (**GitHub actually runs it only every ~5–6 h on a free
  account**), `workflow_dispatch` (with an optional `reason` input shown as the run name), and on push to main.
  Deploys to GitHub Pages (Source: GitHub Actions). Commits `token.enc` and `cache/`, plus a keep-alive commit if
  idle > 40 days.
- **Instant import (25.09.2026)** – `webhook/` is a separate tiny **Netlify** site (his existing account; Base
  directory `webhook`) with one function, `netlify/functions/strava.mjs`: Strava's webhook calls
  `/strava/<WEBHOOK_KEY>`, the function answers Strava's validation GET and on an activity event starts
  `update.yaml` through **workflow_dispatch** (not repository_dispatch: that would need a token with Contents
  write; this one has only **Actions: Read and write**). Answers Strava within 1.5 s even if GitHub hangs. Netlify
  env: `WEBHOOK_KEY`, `GH_TOKEN`, optional `STRAVA_ATHLETE_ID`. `netlify.toml` skips Netlify deploys unless
  `webhook/` changed (Netlify's free plan counts deploys). `.github/workflows/strava-webhook.yaml` +
  `webhook/subscribe.py` register / show / remove the Strava subscription (GitHub secret `WEBHOOK_KEY`, same value).
  His setup steps are in `webhook/README.md`. Settings also has **Fetch new runs now** (same workflow_dispatch with
  the device's token, which then needs Actions: Read and write too), and polls for the new version for 8 min.
- `token.enc` – Strava refresh token, AES with a key from `STRAVA_CLIENT_SECRET`. Never commit it in plaintext.
- `settings.enc` holds `max_hr` and an optional `race` `{name, date, m, goal}` – both validated in `load_settings()`.
- `notes.enc`, `settings.enc`, `plan.enc` – written **from the browser** with the dashboard password (the login
  shell hands it over in `sessionStorage`) through the GitHub Contents API, using a **fine-grained PAT**
  (this repo only, Contents read/write) pasted once per device in Settings and kept in `localStorage`. Reading
  needs no token – the page pulls them from `raw.githubusercontent.com`. Every save goes to `localStorage`
  first. A push triggers the rebuild, which bakes the change into the page. Appearance, basemap and route
  style are per device (`pref-*`), not synced.
- GitHub secrets (do not rename): `STRAVA_CLIENT_SECRET`, `STRAVA_REFRESH_TOKEN`, `DASHBOARD_PASSWORD`, and
  `WEBHOOK_KEY` (only for the doorbell).
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
Built (as of 24.09.2026):
1. **Home** – the next session from the (editable) plan with its HR target, this week's strip with ticks,
   three key numbers, the latest run with a coach comment.
2. **Plan** – week/month calendar with drag-to-move, edit, add and remove, synced via `plan.enc`; his own
   plan (see "Your role"); ISO week numbers; a "How this plan works" card with Bakken's key points; HR zones.
3. **Activities** (tab was "Runs") – the whole Strava history, every sport; run page as described above.
4. **Map** – heat map and routes of every activity all the way back (routes load from `routes.bin`), filters
   by period (4 weeks … all time) and kind (runs, easy, long, threshold, hikes & walks, rides, everything).
5. **Progress** – effort this week vs usual range, easy share, metres per beat, cadence; weekly training load;
   speed vs heart rate; aerobic efficiency; time in zones; threshold rep pace; long-run decoupling; cadence;
   weekly distance; **training log** (Strava style), **fitness & freshness**, **this year vs earlier years**,
   **best efforts**, **how hard it felt**, **shoes**. Every chart opens full screen and zooms.
6. **Settings** – appearance, default basemap and route line, max HR, GitHub token, about/update.

Maps history, so it is not re-litigated: the hand-drawn raster map was replaced by MapLibre on 23.09.2026.
**CARTO basemaps need an API key** (watermark "API KEY REQUIRED" since ~Aug 2026; `roboes/strava-local-heatmap-tool`
is out of date on this) – not used. OpenFreeMap needs no key and gives the Positron look he wanted.

Not built yet / ideas: editing the zone percentages; weather per run (Open-Meteo is free and keyless, but it
would send his locations to a third party - ask first).

**Garmin direct (asked 24.09.2026):** not worth it now. Garmin's official APIs are for approved business
partners; the unofficial libraries log in with his Garmin password (kept as a secret, breaks with 2FA and
changes, against Garmin's terms). Strava already delivers everything the app uses. What Garmin alone has:
HRV, sleep, training readiness, Garmin's own lactate-threshold estimate, running dynamics. Revisit only if he
wants those - and then prefer a manual export over storing his password. A real iOS app needs the $99/year Apple
Developer Program – do not spend effort on it unless he decides to pay; the PWA is the free route.
