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
- Runs **3 times per week**: 1 threshold session + 1 easy run + 1 long easy run.
- Threshold progression every 2 weeks: 6×3 → 5×5 → 4×7 → 3×10 min (1–1½ min jog rest). Plan week 1 starts Mon 28.09.2026.
- These values live in `config.json` / `report.py`. Keep coaching claims honest; no lactate meter, so HR is the proxy.

## How the app works today
- `build_site.py` – run by GitHub Actions. Refreshes the Strava token, fetches the last 140 days of activities,
  collects per-run detail via `strava_cache.py`, renders HTML via `report.py`,
  **encrypts it with AES-GCM (PBKDF2-SHA256, 250k rounds)** using `DASHBOARD_PASSWORD`,
  and writes `site/` (index.html login shell + manifest + icon). The browser decrypts with WebCrypto.
- `strava_cache.py` – heart-rate/pace streams and laps for one run, trimmed to ~160 samples plus a bpm
  histogram, kilometre splits and laps. Cached in **`cache/<activity id>.enc`**, AES-encrypted with a key
  derived from `STRAVA_CLIENT_SECRET` (the repo is public), and committed by the workflow, so each run costs
  two API calls once and nothing afterwards. At most 40 new runs per build, and it stops early if Strava's
  rate-limit headers say the window is nearly used up - the rest arrive on the next hourly build.
- `report.py` – all dashboard HTML/CSS/SVG. It renders **one file containing six pages** – Home, Plan, Runs,
  Map, Progress, Settings – plus the menu (bottom tab bar on a phone, sidebar from 860px up). A tiny hash router (`#/home`,
  `#/plan`, …) shows one `<section class="page">` at a time, so switching pages needs no network. The file is in
  five marked parts: settings/helpers, the plan logic, charts (hand-built inline SVG), the pages, and the
  shell (CSS + router). Public API used by `build_site.py`: `render(activities, config, details)` and `RUN_TYPES`.
  The **run page (`#/run/<id>`)** is the one part drawn in the browser instead of in Python: the runs are
  embedded once as JSON (`window.RUNS`) and `RUN_VIEW` renders map, charts, laps and splits from it - far
  smaller than shipping 50 pre-rendered run pages. The map is drawn from `summary_polyline` onto
  raster tiles by hand (web-mercator maths in `RUN_VIEW`); there is **no Leaflet and no third-party
  JavaScript**, and with no network the route still draws on a blank background. Four basemaps: **Plain**
  (Esri Canvas), **Soft** (CARTO Positron / Dark Matter), **Streets** (OSM) and **Satellite** (Esri); the two
  grey ones swap to a dark version with the app's appearance.
  Time in zones comes from the cached bpm histogram (real seconds per zone), not from a run's average.
  **Route styles (23.09.2026)** – the line can be drawn five ways, picked with the button at the bottom
  right of the map and remembered per device in `pref-route`: *Solid* (a line with a contrasting casing
  under it), *Glow* (the warm heat-map look, best on satellite), and three coloured by a stream the way
  Strava's "stat maps" are – *Heart rate* (the app's own zone colours, so the map matches the zone bars),
  *Pace* and *Elevation*. `ROUTE_STYLES` is a list of recipes of stroked layers and `ramp()` mixes colours,
  both written to be reused by the heat map. `alongRoute()` lines a stream up with the drawn route: the
  polyline keeps more points on bends than on straights, so it walks the route adding up length and looks
  up the sample at the same distance into the run. A style whose stream a run never recorded is hidden
  from the menu. The legend at the bottom right names what the colours mean.
- **App behaviour (PWA).** `site/sw.js` is written by every build with a fresh `VERSION` stamp
  (the build time). It precaches the shell and serves same-origin requests network-first, so the app opens
  instantly, **works with no signal**, and still shows the newest page when online. The login shell registers
  it; the dashboard watches for a new worker and shows an **"Update ready · Reload"** bar, so a push to main
  reaches his phone within minutes with no app store and no reinstalling. `make_icon.py` draws
  `icon.png` / `icon-192.png` / `icon-180.png` / `icon-maskable.png` (needs Pillow; the site build does not).
  Verify changes here by serving `site/` over localhost, then testing offline with Playwright's
  `context.set_offline(True)` and the update flow by rebuilding and calling `registration.update()`.
- `config.json` – client_id (281348), max_hr, plan_start, timezone, plan_days
  (which weekday each session lands on: Monday = 0, default threshold Tue, easy Thu, long run Sun).
- `.github/workflows/update.yml` – runs hourly (cron `17 * * * *`), on manual dispatch, and on push to main.
  Deploys to GitHub Pages (Source: GitHub Actions). Commits `token.enc` when Strava rotates the refresh token,
  plus an empty keep-alive commit if the repo is idle > 40 days (scheduled workflows stop after 60 idle days).
- `token.enc` – latest Strava refresh token, AES-encrypted with a key derived from `STRAVA_CLIENT_SECRET`. Never commit it in plaintext.
- `notes.enc` – his own notes per run, `{activity id: {text, updated}}`, AES-encrypted with the **dashboard
  password** (same PBKDF2/AES-GCM scheme as the page). Written **from the browser**: the login shell hands the
  password to the dashboard in `sessionStorage`, so it can decrypt and re-encrypt the file itself.
  Reading needs no token (the file is public, just unreadable) – the page pulls it from
  `raw.githubusercontent.com` on opening a run, so a note written on the phone reaches the PC without waiting
  for a rebuild. Writing uses the GitHub Contents API with a **fine-grained PAT** (this repo only, Contents
  read/write) pasted once per device into the notes card and kept in that browser's `localStorage`.
  Every save also goes to `localStorage` first, so a note is never lost when there is no token or no signal.
  A push triggers the normal rebuild, which bakes the note into the page.
- `settings.enc` – his training settings (`max_hr`, `plan_start`, `plan_days`), written from the Settings page
  exactly like `notes.enc` and read by `load_settings()`, which **validates every field** before letting it
  override `config.json`. Appearance and default map style are *not* in here: they are per device and live in
  `localStorage` under `pref-*`.
- GitHub secrets (do not rename): `STRAVA_CLIENT_SECRET`, `STRAVA_REFRESH_TOKEN`, `DASHBOARD_PASSWORD`.
- Live site: `https://<username>.github.io/trening/` – added to phone home screen as a web app.

## Testing without Strava access
You don't have the secrets. Test with sample data:
```
python make_sample.py                       # sample_activities.json + sample_detail.json (~20 weeks)
MOCK_ACTIVITIES=sample_activities.json DASHBOARD_PASSWORD=test1234 python build_site.py
```
`make_sample.py` simulates each run second by second (speed, HR, altitude, route) and runs it through
`strava_cache._shape`, so the sample detail has exactly the shape the cache stores. `build_site.py` picks up
`sample_detail.json` automatically in mock mode (override with `MOCK_DETAIL`). To check a different week
state, call `report.render(activities, config, details)` directly with `config["today"]` set to another date.
Map tiles cannot be reached from a test sandbox - stub `**tile.openstreetmap.org/**` and
`**arcgisonline.com/**` in Playwright (fulfil with a 1px PNG to see the route against a flat background)
to check map layout, and render with `details={}` to check how a run looks before its detail is cached.
Chromium lives at `/opt/pw-browsers/chromium-1194/chrome-linux/chrome`; pass it as `executable_path`.
Pinch gestures need two fingers, which `page.touchscreen` cannot do - open a CDP session and send
`Input.dispatchTouchEvent` with two touch points. Open `site/index.html`
through a local HTTP server (WebCrypto needs a secure context: localhost is fine) and check **phone width (390px) and desktop**.
Never commit `site/`, sample data with real personal data, or any secret. Add a `.gitignore` for `site/` and `__pycache__/`.

## Rules
- Everything the site shows must stay behind the password (encrypted). Nothing personal in plain files in the repo – the repo is **public**.
- Mobile-first: it's mainly used on a phone. Must also work well on desktop. Light + dark mode.
- Keep the Strava API use well inside rate limits; cache per-activity detail data instead of re-fetching.
- After changes, push to `main` (or open a PR he can merge) – that triggers a rebuild and deploy. Tell him what changed in 1–3 lines.

## Roadmap (requested 22.09.2026)
The **front page + menu** structure is built (22.09.2026): tab bar / sidebar, hash router, and all four pages exist.
What each page holds now, and what is still missing:
1. **Home** – done: next/today's session with HR target, week strip with ticks, three key numbers,
   latest run with a coach comment.
2. **Plan** – shows this week's three sessions (ticked when done), the threshold progression with "you are here",
   the next five weeks and the HR zones. **Still to do: editing the plan, and a month calendar view.**
3. **Runs** – done: list grouped by month, each opening a **run page** (`#/run/<id>`) with a draggable,
   zoomable map (Map / Terrain / Satellite), stats, heart-rate/pace/elevation charts that pop out and zoom,
   laps (threshold reps highlighted), kilometre splits, a true time-in-zones breakdown, and **his own notes**
   that sync between devices.
4. **Progress** – weekly volume, time in zones, easy pace at easy HR, threshold-session pace over time.
   **Still to do: best efforts (1k/5k/10k) and run-vs-run comparison.**
**Better maps – settled 23.09.2026: staying with raster tiles.** The route styles above were added instead
of changing provider. Vendoring MapLibre was considered and rejected - ~40k lines to keep patched forever,
and it would run beside the dashboard password in the browser. What was found:
  * **CARTO Positron / Dark Matter** is shipped as the **Soft** layer (23.09.2026). An earlier note here said
    it needs an API key - **that was wrong**, and came from looking at CARTO's newer hosted product. The plain
    raster CDN `{s}.basemaps.cartocdn.com/{light_all,dark_all}/{z}/{x}/{y}{r}.png` is keyless, which
    `roboes/strava-local-heatmap-tool` uses exactly that way. It also serves **real retina tiles** (`{r}` →
    `@2x`), so `SlippyMap.prototype.finer()` returns 0 for a layer marked `retina: true`: one crisp 256px tile
    per position instead of four from a zoom deeper, which is sharper *and* a quarter of the requests.
  * **OpenFreeMap** is keyless, unlimited and free, but serves **vector** tiles, so it needs MapLibre GL JS
    (~250 KB gzipped) vendored into the repo. **Rejected, see above.**
  * Keyless raster alternatives (Esri canvas/imagery, OSM, CyclOSM) are the other layers.
  Note: tile servers are unreachable from the test sandbox, so any new tile URL cannot be verified here - keep
  to well-known URL patterns and have him confirm on the phone.

**Asked for on 22.09.2026, not built yet:**
5. **Map page in the menu** – the tab and page exist (23.09.2026) but hold only a placeholder, on his
   instruction to finish the run map first and copy the style across. Still to do: a full-screen map showing
   more than one run, plus a **heat map** of where he runs most often. `SlippyMap` and `ROUTE_STYLES` are
   both reusable.
   **How to draw the heat (settled 23.09.2026, from `roboes/strava-local-heatmap-tool`, which he sent):**
   do **not** count overlaps. Draw every route as a thin, translucent line (that tool uses weight 1.0 at
   opacity 0.6 on a dark basemap) and let the browser's own alpha blending do the work - roads run many times
   stack up bright, a one-off stays faint. This is both simpler and better-looking than counting, and it
   sidesteps a real problem: our routes come from `summary_polyline`, which is decimated per activity, so the
   same road recorded twice gives two slightly different squiggles that would never share a segment to count.
   The `Glow` style already layers strokes this way; the heat map is the same idea with no casing and a much
   thinner core. Also worth copying from that tool: **tapping a line opens that activity** (for us, straight
   to `#/run/<id>`) and a **filter** on which runs are shown.
   Watch performance: 50 runs x a few hundred points each is tens of thousands of SVG segments, which will
   drag badly on a phone. Expect to draw the heat layer to a `<canvas>` instead of SVG, keeping SVG only for
   the single-run page. What is *not* worth taking from that tool: it is a desktop Python script that needs
   Strava's **bulk export** zip and renders through Folium (= Leaflet = third-party JavaScript). We already
   have the routes live from the API, and no-third-party-JS is a property worth keeping.
6. **Settings page** – done 23.09.2026: appearance (light / dark / follow system), default map style, training
   settings (max HR, plan start, which weekday each session lands on), the GitHub token (moved here from the
   notes card), and an About card with the build version, a "check for update" button and a "clear this device"
   escape hatch. **Still possible later:** editing the zone percentages, shoe mileage, race goal.
7. **A real installable app** – **checked 23.09.2026: TestFlight needs the Apple Developer Program at
   $99/year**, plus a Mac to build on, so it breaks the no-paid-services rule. The free route was built
   instead: the PWA above (installable, offline, instant updates). Remaining free options if he wants more:
   an Android APK via Bubblewrap/TWA that he sideloads (free; the Play Store costs $25 once). A real iOS
   build has no free path. Do not spend effort on iOS unless he decides to pay.

Other ideas not yet asked for: shoe mileage, race goal + predicted time, best efforts, run-vs-run comparison.

**Saving user data (settled 22.09.2026):** encrypted JSON file in the repo, written from the browser via the
GitHub API with a fine-grained PAT kept in `localStorage` per device – see `notes.enc` above. Reuse exactly this
pattern for plan edits and settings; the encryption helpers already live in `RUN_VIEW`'s notes section.
