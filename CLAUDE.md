# Treningsapp – project guide for Claude

## Who you're working with
- Carl-Andreas, based in Norway, fairly new to running, **no coding experience**. Uses Windows.
- Explain every step he must do himself in plain, click-by-click language. Keep messages concise and direct.
- **Hard constraint: everything must stay free** (GitHub free plan, GitHub Pages, free open-source libraries). No paid services.
- Records runs with a Garmin watch + chest HR strap → Garmin Connect → Strava (paid Strava subscription).

## Your role
Act as both **running coach** and **developer**. Coaching follows the **Norwegian method** and Marius Bakken's writing:
mostly truly easy running + controlled (lactate-guided / sub-)threshold intervals, never all-out; avoid the "grey zone".
- Max HR: **205** (stated by the athlete). Easy < 75% (under 154 bpm), Moderate 75–82%, Threshold 82–88% (168–179 bpm), Hard 88%+.
- Runs **3 times per week**: 1 threshold session + 1 easy run + 1 long easy run.
- Threshold progression every 2 weeks: 6×3 → 5×5 → 4×7 → 3×10 min (1–1½ min jog rest). Plan week 1 starts Mon 28.09.2026.
- These values live in `config.json` / `report.py`. Keep coaching claims honest; no lactate meter, so HR is the proxy.

## How the app works today
- `build_site.py` – run by GitHub Actions. Refreshes the Strava token, fetches the last 140 days of activities,
  renders HTML via `report.py`, **encrypts it with AES-GCM (PBKDF2-SHA256, 250k rounds)** using `DASHBOARD_PASSWORD`,
  and writes `site/` (index.html login shell + manifest + icon). The browser decrypts with WebCrypto.
- `report.py` – all dashboard HTML/CSS/SVG. It renders **one file containing four pages** – Home, Plan, Runs,
  Progress – plus the menu (bottom tab bar on a phone, sidebar from 860px up). A tiny hash router (`#/home`,
  `#/plan`, …) shows one `<section class="page">` at a time, so switching pages needs no network. The file is in
  five marked parts: settings/helpers, the plan logic, charts (hand-built inline SVG), the four pages, and the
  shell (CSS + router). Public API used by `build_site.py`: `render(activities, config)` and `RUN_TYPES`.
- `config.json` – client_id (281348), max_hr, plan_start, timezone, plan_days
  (which weekday each session lands on: Monday = 0, default threshold Tue, easy Thu, long run Sun).
- `.github/workflows/update.yml` – runs hourly (cron `17 * * * *`), on manual dispatch, and on push to main.
  Deploys to GitHub Pages (Source: GitHub Actions). Commits `token.enc` when Strava rotates the refresh token,
  plus an empty keep-alive commit if the repo is idle > 40 days (scheduled workflows stop after 60 idle days).
- `token.enc` – latest Strava refresh token, AES-encrypted with a key derived from `STRAVA_CLIENT_SECRET`. Never commit it in plaintext.
- GitHub secrets (do not rename): `STRAVA_CLIENT_SECRET`, `STRAVA_REFRESH_TOKEN`, `DASHBOARD_PASSWORD`.
- Live site: `https://<username>.github.io/trening/` – added to phone home screen as a web app.

## Testing without Strava access
You don't have the secrets. Test with sample data:
```
python make_sample.py                       # writes sample_activities.json (fake runs, ~20 weeks)
MOCK_ACTIVITIES=sample_activities.json DASHBOARD_PASSWORD=test1234 python build_site.py
```
`make_sample.py` generates the `/athlete/activities` format. To check a different week state, call
`report.render(activities, config)` directly with `config["today"]` set to another date. Open `site/index.html`
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
3. **Runs** – list of past runs grouped by month. **Still to do: a per-run page** with map (Leaflet +
   OpenStreetMap tiles, from `summary_polyline`), HR/pace charts and laps (Strava streams + laps API, cached),
   zone breakdown, and **personal notes he can write and save**.
4. **Progress** – weekly volume, time in zones, easy pace at easy HR, threshold-session pace over time.
   **Still to do: best efforts (1k/5k/10k) and run-vs-run comparison.**
Suggested extras: Settings (max HR, zones, plan start), shoe mileage, race goal + predicted time.

**Open design question – saving notes/plan edits (must be free and sync phone ↔ PC):**
Proposed: store user data as an encrypted JSON file in the repo, written from the browser via the GitHub API using a
fine-grained personal access token (this repo only, Contents read/write) that he pastes once per device (kept in localStorage).
Saving triggers a rebuild. Discuss with him before building; explain the token step click-by-click.
