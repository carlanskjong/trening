"""
Turns a list of Strava activities into the dashboard.

The dashboard is one HTML page with six sub-pages - Home, Plan, Runs, Map,
Progress, Settings - and a menu (bottom tab bar on a phone, sidebar on a
desktop). It is shipped as one encrypted file, so switching pages is instant
and works offline once opened.

This file builds what is fixed at build time: the numbers and the page
skeletons. Everything drawn or interactive - charts, the run page, maps, the
plan calendar, settings - is browser code in web/*.js, which this file
inlines in the order of APP_FILES.

Layout of this file:
  1. Settings and small helpers (zones, effort, efficiency, decoupling)
  2. The training plan (the standard plan, as data the Plan page edits)
  3. Chart data (the charts are drawn in the browser)
  4. The pages
  5. Shell: menu, and the assembly of CSS and scripts
"""
import json
import re
from collections import defaultdict
from datetime import datetime, timedelta, date
from html import escape
from pathlib import Path

import strava_cache
import training_plan

WEB = Path(__file__).resolve().parent / "web"


def _web(name):
    """The browser code lives in web/ as real .js/.css files; the page inlines it."""
    return (WEB / name).read_text(encoding="utf-8")


# ---------------------------------------------------------------- 1. settings

RUN_TYPES = {"Run", "TrailRun", "VirtualRun"}
WEEKS_SHOWN = 16          # bars in the weekly distance chart
RUNS_LISTED = 60          # rows on the Runs page

# Intensity zones as % of max heart rate (Norwegian-method inspired)
ZONES = [
    ("easy", "Easy", 0, 75, "Conversational. Most of your running belongs here."),
    ("moderate", "Moderate", 75, 82, "The 'grey zone': too hard to be easy, too easy to be quality."),
    ("threshold", "Threshold", 82, 88, "Controlled hard. Your interval sessions live here."),
    ("hard", "Hard", 88, 101, "Races and very hard efforts."),
]
NAMES = {z[0]: z[1] for z in ZONES} | {"nohr": "No heart rate"}
COLORS = {"easy": 1, "moderate": 2, "threshold": 3, "hard": 4, "nohr": 0}
ORDER = ["easy", "moderate", "threshold", "hard", "nohr"]

WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
SHORT_DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]

PAGES = [("home", "Home"), ("plan", "Plan"), ("runs", "Runs"), ("map", "Map"),
         ("progress", "Progress"), ("settings", "Settings")]
SECTIONS = PAGES + [("run", "Run")]   # /run/<id> has no tab of its own


# ----------------------------------------------------------------- helpers

def run_date(run):
    return datetime.fromisoformat(run["start_date_local"].replace("Z", ""))


def zone_for_pct(pct):
    for key, _, lo, hi, _ in ZONES:
        if lo <= pct < hi:
            return key
    return "hard"


def zone_of(run, max_hr):
    """The zone a whole run lands in, from its average heart rate."""
    hr = run.get("average_heartrate")
    return zone_for_pct(hr / max_hr * 100) if hr else "nohr"


def run_kind(run):
    """What sort of session a run was: 'threshold', 'long' or 'easy'.
    Judged by time actually spent at threshold or above, not by the average -
    an interval session's average includes the warm-up and the jogs."""
    zs = run.get("_zone_seconds") or {}
    if zs.get("threshold", 0) + zs.get("hard", 0) >= 8 * 60:
        return "threshold"
    return "long" if run.get("moving_time", 0) >= 55 * 60 else "easy"


# Edwards' heart-rate load: each minute counts 1-5 by how hard it was.
EFFORT_BANDS = [(50, 60, 1), (60, 70, 2), (70, 80, 3), (80, 90, 4), (90, 101, 5)]


def effort_of(run, max_hr):
    """Heart-rate load for one run (Edwards' TRIMP). Exact from the cached
    seconds-per-bpm histogram; from the average heart rate when there is none."""
    hist = (run.get("_detail") or {}).get("hrhist")
    score = 0.0
    if hist:
        for i, secs in enumerate(hist):
            pct = (strava_cache.HR_MIN + i) / max_hr * 100
            for lo, hi, w in EFFORT_BANDS:
                if lo <= pct < hi:
                    score += secs / 60 * w
        return round(score)
    hr = run.get("average_heartrate")
    if not hr:
        return None
    pct = hr / max_hr * 100
    w = next((w for lo, hi, w in EFFORT_BANDS if lo <= pct < hi), 0)
    return round(run["moving_time"] / 60 * w)


def rep_pace(run, max_hr):
    """(seconds per km, average bpm) over the laps run at threshold or above -
    the reps of an interval session without the warm-up and the jogs."""
    laps = (run.get("_detail") or {}).get("laps") or []
    reps = [l for l in laps if l.get("hr") and l["hr"] >= max_hr * 0.82 and l.get("m", 0) >= 300]
    if len(reps) < 2:
        return None
    m, secs = sum(l["m"] for l in reps), sum(l["s"] for l in reps)
    return secs / (m / 1000), sum(l["hr"] * l["s"] for l in reps) / secs


def decoupling(run):
    """Aerobic decoupling (Pa:HR): how much less distance each heartbeat buys in
    the second half than the first, in %. Under 5% means the heart rate held
    steady for the pace - good aerobic endurance. The first 10 minutes are left
    out, while heart rate is still climbing."""
    det = run.get("_detail") or {}
    t, d, hr = det.get("t") or [], det.get("d") or [], det.get("hr") or []
    if len(t) < 40 or len(hr) != len(t) or len(d) != len(t) or t[-1] < 45 * 60:
        return None
    idx = [i for i in range(len(t)) if t[i] >= 600 and hr[i] and d[i] is not None]
    if len(idx) < 20:
        return None
    half = t[idx[0]] + (t[idx[-1]] - t[idx[0]]) / 2
    def ef(part):
        if len(part) < 5:
            return None
        dist, secs = d[part[-1]] - d[part[0]], t[part[-1]] - t[part[0]]
        beats = sum(hr[i] for i in part) / len(part)
        return dist / secs / beats if secs and beats else None
    a, b = ef([i for i in idx if t[i] <= half]), ef([i for i in idx if t[i] > half])
    return round((a - b) / a * 100, 1) if a and b else None


def zones_from_histogram(hist, max_hr):
    """Seconds per zone from the cached bpm histogram - the honest version of
    zone_of(), because a threshold session is not one single zone."""
    out = defaultdict(int)
    for i, seconds in enumerate(hist or []):
        if seconds:
            out[zone_for_pct((strava_cache.HR_MIN + i) / max_hr * 100)] += seconds
    return dict(out)


def fmt_pace(seconds, meters):
    if not meters:
        return "-"
    s = seconds / (meters / 1000)
    return f"{int(s // 60)}:{int(s % 60):02d}"


def fmt_time(seconds):
    h, m = divmod(int(seconds) // 60, 60)
    return f"{h} h {m:02d} min" if h else f"{m} min"


def fmt_hours(seconds):
    h, m = divmod(int(seconds) // 60, 60)
    return f"{h}h {m:02d}m" if h else f"{m} min"


def hr_text(run):
    hr = run.get("average_heartrate")
    return f"{hr:.0f}" if hr else "-"


def bpm(max_hr, pct):
    return round(max_hr * pct / 100)


def zone_range(max_hr, lo, hi):
    if lo == 0:
        return f"under {bpm(max_hr, hi)}"
    if hi > 100:
        return f"{bpm(max_hr, lo)}+"
    return f"{bpm(max_hr, lo)}–{bpm(max_hr, hi) - 1}"


def dot(zone):
    return f'<i class="dot s{COLORS[zone]}"></i>'


def day_word(d, today):
    """'Today', 'Tomorrow', 'Yesterday' or the weekday name."""
    diff = (d - today).days
    if diff == 0:
        return "Today"
    if diff == 1:
        return "Tomorrow"
    if diff == -1:
        return "Yesterday"
    return WEEKDAYS[d.weekday()]


def card(body, cls="", head=None, link=None):
    title = ""
    if head:
        more = f'<a class="more" href="#/{link[0]}">{link[1]}</a>' if link else ""
        title = f"<h2>{head}{more}</h2>"
    return f'<section class="card {cls}">{title}{body}</section>'


# ------------------------------------------------------------------- 2. plan

DAY_INDEX = {"mon": 0, "tue": 1, "wed": 2, "thu": 3, "fri": 4, "sat": 5, "sun": 6}


# "10 min oppvarming + 5×6 min, p: 90 sek + 5 min nedjogg" -> the set in the
# title, warm-up and cool-down in the notes, so a week reads at a glance.
WRAPPED = re.compile(r"^(\d+(?:–\d+)? min (?:oppvarming|svært lett jogg)) \+ (.+) \+ "
                     r"(\d+(?:–\d+)? min (?:nedjogg|svært lett jogg|rolig jogg))$")


def split_title(title, detail):
    m = WRAPPED.match(title)
    if not m:
        return title, detail
    warm, core, cool = m.groups()
    frame = f"{warm[0].upper()}{warm[1:]} før, {cool} etter."
    return core[0].upper() + core[1:], f"{frame}\n{detail}" if detail else frame


def standard_plan(today, days_back=140):
    """
    His training plan (training_plan.py) as the list of sessions the Plan page
    edits. Only from `days_back` days ago: older sessions have no runs in the
    data to tick them off, and would look missed when they were not.
    Ids are stable ('2026-W40-2'), so an edited plan can tell sessions apart.
    """
    first = today - timedelta(days=days_back)
    out, last = [], None
    for week, sessions in sorted(training_plan.WEEKS.items()):
        monday = date.fromisocalendar(training_plan.YEAR, week, 1)
        for n, (day, kind, title, detail, optional) in enumerate(sessions, 1):
            when = monday + timedelta(days=DAY_INDEX[day])
            last = monday + timedelta(days=6)
            if when < first:
                continue
            title, detail = split_title(title, detail)
            item = {"id": f"{training_plan.YEAR}-W{week:02d}-{n}", "date": when.isoformat(), "type": kind,
                    "title": title, "detail": detail}
            if optional:
                item["opt"] = True
            out.append(item)
    return {"sessions": out, "until": last.isoformat() if last else today.isoformat(),
            "version": training_plan.VERSION}


def coach_note(run, max_hr):
    """One honest sentence about the latest run."""
    if not run:
        return "No runs in the last 140 days yet. The first easy run is the whole plan for now."
    zone, hr = run["_zone"], run.get("average_heartrate")
    easy_max, thr_lo, thr_hi = bpm(max_hr, 75), bpm(max_hr, 82), bpm(max_hr, 88) - 1
    if zone == "nohr":
        return ("No heart rate on this one. Check that the chest strap is damp and sitting snug - "
                "without it the zones are guesswork.")
    if zone == "easy":
        if hr > easy_max - 6:
            return (f"Easy, but only just: {hr:.0f} bpm against a ceiling of {easy_max}. "
                    f"On the next easy run aim a little lower - it should feel almost lazy.")
        return (f"Well judged. {hr:.0f} bpm is comfortably inside easy (under {easy_max}), "
                f"which is exactly where most of your running should sit.")
    if zone == "moderate":
        return (f"{hr:.0f} bpm puts this in the grey zone - harder than easy, easier than threshold. "
                f"It tires you without the threshold payoff. Slow the easy days down to under {easy_max} bpm.")
    if zone == "threshold":
        return (f"Average {hr:.0f} bpm - proper threshold work ({thr_lo}–{thr_hi} bpm). "
                f"Keep the reps controlled: you should finish feeling you had one more in you.")
    return (f"Average {hr:.0f} bpm is above threshold. Fine for a race or a hard hill, but it is not "
            f"part of the plan - the hard days are meant to be controlled, not all-out.")


# ------------------------------------------------------------- 3. chart data

def progress_payload(d):
    """The numbers behind the Progress charts. The charts themselves are drawn
    in the browser (web/progress.js), at the size they are shown and zoomable.
    Tooltip texts are 'Title|line|line', already HTML-escaped."""
    weeks, iso = d["weeks"], lambda x: x.isoformat()

    def load_tip(w, v):
        band = d["effort_band"].get(w)
        runs_n = sum(1 for r in d["runs"] if r["_date"].date() - timedelta(days=r["_date"].weekday()) == w)
        return (f"Week of {w.strftime('%d.%m')}|Effort {v:.0f} from {runs_n} run{'s' if runs_n != 1 else ''}"
                + (f"|Usual range {band[0]:.0f}–{band[1]:.0f}" if band else ""))
    km = [round(sum(d["week_km"][w].values()), 1) for w in weeks]
    return {
        "load": {"weeks": [iso(w) for w in weeks], "v": [d["week_effort"].get(w, 0) for w in weeks],
                 "band": [[round(x) for x in d["effort_band"][w]] if w in d["effort_band"] else None for w in weeks],
                 "tips": [load_tip(w, d["week_effort"].get(w, 0)) for w in weeks]},
        "dist": {"weeks": [iso(w) for w in weeks], "v": km,
                 "tips": [f"Week of {w.strftime('%d.%m')}|{v:.1f} km" for w, v in zip(weeks, km)]},
        "shr": [[round(hr, 1), round(pc, 1), tip, rec] for hr, pc, tip, rec in d["speed_hr"]],
        "eff": [[iso(dt), round(v, 3), tip] for dt, v, tip in d["eff_points"]],
        "reps": [[iso(dt), round(v, 1), tip] for dt, v, tip in d["rep_points"]],
        "cad": [[iso(dt), v, tip] for dt, v, tip in d["cad_points"]],
    }


def chart_slot(key, label, empty=None):
    """An empty box the browser draws a Progress chart into."""
    note = f'<p class="sub pc-empty" hidden>{empty}</p>' if empty else ""
    return f'<div class="pc" data-chart="{key}" aria-label="{escape(label)}"></div>{note}'


def zone_bar(zone_seconds):
    """One horizontal bar showing how running time was split between the zones."""
    total = sum(zone_seconds.values())
    if not total:
        return '<p class="sub">No runs with heart rate yet.</p>'
    rows, x = [], 0.0
    for k in ORDER:
        v = zone_seconds.get(k, 0)
        if not v:
            continue
        w = v / total * 100
        rows.append(f'<div class="bar-seg s{COLORS[k]}" style="width:{w:.2f}%" '
                    f'title="{NAMES[k]}: {fmt_hours(v)}"></div>')
        x += w
    legend = "".join(
        f'<div class="zrow"><span>{dot(k)}{NAMES[k]}</span>'
        f'<span class="num">{fmt_hours(zone_seconds[k])} · {zone_seconds[k]/total*100:.0f}%</span></div>'
        for k in ORDER if zone_seconds.get(k))
    return f'<div class="bar">{"".join(rows)}</div><div class="zlist">{legend}</div>'


# ------------------------------------------------------------------ 4. pages

def page_home(d):
    max_hr, today = d["max_hr"], d["today"]

    # ---- key numbers
    trend = f'avg {d["avg4"]:.1f} km' if d["avg4"] > 0.5 else 'building up'
    tiles = (f'<div class="tiles">'
             f'<div class="tile"><div class="label">This week</div>'
             f'<div class="value">{d["this_week_km"]:.1f}<span class="unit">km</span></div>'
             f'<div class="note">since Monday · {trend}</div></div>'
             f'<div class="tile"><div class="label">Easy share</div>'
             f'<div class="value">{d["easy_share"]}</div>'
             f'<div class="note">28 days · goal ~80%</div></div>'
             f'<div class="tile"><div class="label">Runs</div>'
             f'<div class="value">{d["runs28"]}</div>'
             f'<div class="note">last 28 days</div></div>'
             f'</div>')

    # ---- latest run
    last = d["latest"]
    if last:
        z = last["_zone"]
        latest_body = (
            f'<div class="runhead"><b>{escape(last["name"])}</b>'
            f'<span class="when">{day_word(last["_date"].date(), today)} · '
            f'{last["_date"].strftime("%d.%m")}</span></div>'
            f'<div class="metrics">'
            f'<div><span class="m">{last["distance"]/1000:.1f}</span><span class="u">km</span></div>'
            f'<div><span class="m">{fmt_hours(last["moving_time"])}</span><span class="u">time</span></div>'
            f'<div><span class="m">{fmt_pace(last["moving_time"], last["distance"])}</span><span class="u">/km</span></div>'
            f'<div><span class="m">{hr_text(last)}</span><span class="u">bpm</span></div>'
            f'</div><p class="zoneline">{dot(z)}{NAMES[z]}</p>'
            f'<p class="note-coach">{coach_note(last, max_hr)}</p>')
    else:
        latest_body = f'<p class="note-coach">{coach_note(None, max_hr)}</p>'

    return ('<section class="card nx" id="homenext"></section>'
            + card('<p class="sub tight" id="homeweeksub"></p><div class="week" id="homeweek"></div>',
                   head="This week", link=("plan", "Plan"))
            + tiles
            + card(latest_body, head="Latest run", link=("runs", "All runs")))


def page_plan(d):
    """The calendar is drawn in the browser (web/plan.js) so sessions can be moved
    and edited on the spot; the progression and zones are fixed reference."""
    max_hr = d["max_hr"]
    calendar = (
        '<div class="cal-head">'
        '<button type="button" class="calnav" data-cal="prev" aria-label="Earlier">‹</button>'
        '<div class="cal-title"><b id="caltitle"></b><span id="calsub"></span></div>'
        '<button type="button" class="calnav" data-cal="next" aria-label="Later">›</button>'
        '</div>'
        '<div class="cal-tools">'
        '<div class="choices" id="calview" role="group" aria-label="Calendar view">'
        '<button type="button" data-view="week">Week</button><button type="button" data-view="month">Month</button></div>'
        '<button type="button" class="btn small ghost" data-cal="today">Today</button>'
        '</div>'
        '<div id="calbody" class="cal-body"></div>'
        '<p class="hint" id="calhint">Hold a session and drag it to another day. Tap it to change, move or remove it, '
        'and + to add one.</p>'
        '<div class="plan-foot"><span class="hint" id="planstatus"></span>'
        '<button type="button" class="more" id="planreset" hidden>Back to the standard plan</button></div>')

    guide = "".join(f'<div class="guide-item"><b>{escape(head)}</b><p>{escape(text)}</p></div>'
                    for head, text in training_plan.GUIDE)
    guide_body = (f'<div class="guide">{guide}</div>'
                  f'<p class="hint">Threshold for you is about {bpm(max_hr, 82)}–{bpm(max_hr, 88) - 1} bpm, low '
                  f'threshold the bottom of that - around {bpm(max_hr, 82) - 1}–{bpm(max_hr, 84)}. Heart rate lags '
                  f'at the start of a rep, so run the first minute by feel.</p>')

    zone_rows = "".join(
        f'<tr><td class="wrap">{dot(k)}<b>{label}</b><div class="desc">{why}</div></td>'
        f'<td class="num">{zone_range(max_hr, lo, hi)}</td></tr>' for k, label, lo, hi, why in ZONES)
    zones_body = (f'<div class="scroll"><table><tr><th>Zone</th><th>Heart rate (bpm)</th></tr>'
                  f'{zone_rows}</table></div>'
                  f'<p class="hint">Based on a max heart rate of {max_hr} bpm.</p>')

    return (card(calendar, cls="calcard")
            + card(guide_body, head="How this plan works")
            + card(zones_body, head="Your heart rate zones"))


def page_runs(d):
    runs = d["runs"][:RUNS_LISTED]
    if not runs:
        return card('<p class="sub">No runs found in the last 140 days.</p>', head="Runs")
    months, current = [], None
    for r in runs:
        key = r["_date"].strftime("%B %Y")
        if key != current:
            current = key
            months.append(f'<h3 class="month">{key}</h3>')
        z = r["_zone"]
        months.append(
            f'<a class="runrow" href="#/run/{r["id"]}" style="--zc:var(--z-{z})">'
            f'<div class="rmain"><span class="rdate">{SHORT_DAYS[r["_date"].weekday()]} '
            f'{r["_date"].strftime("%d.%m")}</span>'
            f'<span class="rname">{escape(r["name"])}</span>'
            f'<span class="rzone">{dot(z)}{NAMES[z]}</span></div>'
            f'<div class="rnums"><span><b>{r["distance"]/1000:.1f}</b> km</span>'
            f'<span><b>{fmt_time(r["moving_time"])}</b></span>'
            f'<span><b>{fmt_pace(r["moving_time"], r["distance"])}</b> /km</span>'
            f'<span><b>{hr_text(r)}</b> bpm</span>'
            f'<span class="chev">›</span></div></a>')
    total_km = sum(r["distance"] for r in d["runs"]) / 1000
    total_time = sum(r["moving_time"] for r in d["runs"])
    summary = (f'<div class="tiles">'
               f'<div class="tile"><div class="label">Runs</div><div class="value">{len(d["runs"])}</div>'
               f'<div class="note">last 140 days</div></div>'
               f'<div class="tile"><div class="label">Distance</div>'
               f'<div class="value">{total_km:.0f}<span class="unit">km</span></div>'
               f'<div class="note">last 140 days</div></div>'
               f'<div class="tile"><div class="label">Time</div>'
               f'<div class="value">{fmt_hours(total_time)}</div><div class="note">moving time</div></div>'
               f'</div>')
    waiting = len(d["runs"]) - d["detailed"]
    note = ("" if not waiting else
            f'<p class="hint">{waiting} older run{"s" if waiting != 1 else ""} still '
            f'{"have" if waiting != 1 else "has"} no heart-rate detail yet - the hourly update fetches '
            f'a batch at a time to stay inside Strava\'s limits.</p>')
    listing = (f'<div class="runs">{"".join(months)}</div>'
               f'<p class="hint">Tap a run for its map, heart-rate curve, laps and splits.</p>{note}')
    return summary + card(listing, head=f"Last {min(len(d['runs']), RUNS_LISTED)} runs")


def runs_payload(d):
    """Compact JSON for the run pages. Short keys because every byte is shipped."""
    out = []
    for r in d["runs"]:
        det = r["_detail"] or {}
        item = {
            "id": r["id"], "n": r["name"], "dt": r["_date"].isoformat(),
            "m": round(r["distance"]), "s": round(r["moving_time"]),
            "e": round(r.get("elapsed_time") or r["moving_time"]),
            "up": round(r.get("total_elevation_gain") or 0),
            "hr": round(r["average_heartrate"]) if r.get("average_heartrate") else None,
            "mhr": round(r["max_heartrate"]) if r.get("max_heartrate") else None,
            "cad": round(r["average_cadence"] * 2) if r.get("average_cadence") else None,
            "z": r["_zone"], "k": r["_kind"], "re": r["_effort"],
            "poly": (r.get("map") or {}).get("summary_polyline") or "",
            "zs": {k: round(v) for k, v in r["_zone_seconds"].items() if v},
        }
        if det:
            item |= {"t": det.get("t") or [], "d": det.get("d") or [],
                     "hs": det.get("hr") or [], "sp": det.get("sp") or [],
                     "al": det.get("alt") or [], "cd": det.get("cad") or [],
                     "laps": det.get("laps") or [], "sl": det.get("splits") or []}
        out.append(item)
    return out


def page_map(d):
    """A full-screen map of every run; web/mappage.js draws it when the tab opens."""
    chip = lambda attr, val, label: f'<button type="button" data-{attr}="{val}">{label}</button>'
    basemaps = "".join(
        f'<button type="button" role="menuitemradio" data-basemap="{k}"><span><b>{n}</b><small>{h}</small></span></button>'
        for k, n, h in (("map", "Map", "Clean and quiet, follows light or dark"),
                        ("outdoor", "Outdoor", "Trails, forest and paths"),
                        ("satellite", "Satellite", "Aerial photos")))
    return (
        '<div class="mp" id="mappage">'
        '<div class="mp-map"></div>'
        '<div class="mp-top">'
        '<div class="choices mp-mode" role="group" aria-label="What to show">'
        + chip("mode", "heat", "Heat map") + chip("mode", "routes", "Routes") +
        '</div>'
        '<div class="mp-chips" role="group" aria-label="Which runs">'
        + "".join(chip("period", k, n) for k, n in (("28", "4 weeks"), ("91", "3 months"), ("all", "All"))) +
        '<span class="mp-sep" aria-hidden="true"></span>'
        + "".join(chip("kind", k, n) for k, n in (("all", "All runs"), ("easy", "Easy"),
                                                  ("long", "Long"), ("threshold", "Threshold"))) +
        '</div><p class="mp-stats"></p></div>'
        '<div class="mv-side mp-side">'
        '<button type="button" class="mbtn txt" data-act="3d" aria-pressed="false" aria-label="3D terrain">3D</button>'
        '<button type="button" class="mbtn" data-act="basemap" aria-label="Background map" aria-haspopup="menu">'
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" '
        'stroke-linejoin="round" aria-hidden="true"><path d="m12 3 9 5-9 5-9-5z"/><path d="m3 13 9 5 9-5"/></svg></button>'
        '<button type="button" class="mbtn" data-act="fit" aria-label="Show all runs">'
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" '
        'stroke-linejoin="round" aria-hidden="true"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg></button>'
        '</div>'
        f'<div class="mpop" data-menu="basemap" hidden role="menu">{basemaps}</div>'
        '<div class="mlegend" hidden></div>'
        '<div class="mp-card" hidden></div>'
        '</div>')


def page_settings(d):
    """
    Two kinds of setting. Appearance and map style are per device and take effect
    instantly (they live in this browser). The training settings change what the
    dashboard is built from, so they are saved to the repo like notes are and apply
    on the next build - within a few minutes of saving.
    """
    appearance = (
        '<div class="choices" id="themechoice" role="group" aria-label="Appearance">'
        '<button type="button" data-theme="system">Follow phone</button>'
        '<button type="button" data-theme="light">Light</button>'
        '<button type="button" data-theme="dark">Dark</button></div>'
        '<p class="hint">"Follow phone" uses whatever your phone or PC is set to, '
        'including switching itself at night.</p>')

    maps = (
        '<p class="eyebrow" style="margin:0 0 8px">Background</p>'
        '<div class="choices" id="mapchoice" role="group" aria-label="Background map">'
        '<button type="button" data-map="map">Map</button>'
        '<button type="button" data-map="outdoor">Outdoor</button>'
        '<button type="button" data-map="satellite">Satellite</button></div>'
        '<p class="eyebrow" style="margin:16px 0 8px">Route line</p>'
        '<div class="choices wrap" id="routechoice" role="group" aria-label="Route line">'
        '<button type="button" data-route="solid">Solid</button>'
        '<button type="button" data-route="glow">Glow</button>'
        '<button type="button" data-route="hr">Heart rate</button>'
        '<button type="button" data-route="pace">Pace</button>'
        '<button type="button" data-route="elev">Elevation</button></div>'
        '<p class="hint">What a map opens with. You can switch on the map itself, and the 3D button '
        'tilts it over the real terrain.</p>')

    training = (
        f'<label class="field"><span>Maximum heart rate</span>'
        f'<input type="number" id="setmaxhr" min="120" max="230" value="{d["max_hr"]}"></label>'
        f'<p class="hint">Every zone is worked out from this. {bpm(d["max_hr"], 82)}–'
        f'{bpm(d["max_hr"], 88) - 1} bpm is your threshold band today.</p>'
        f'<div class="noterow"><button type="button" id="savetraining">Save</button>'
        f'<span class="hint" id="trainingstatus"></span></div>'
        f'<p class="hint">These change how the dashboard is built, so they appear after the '
        f'next update - a few minutes. To move a session to another day, drag it in the '
        f'<a href="#/plan">Plan</a>. Saving needs the GitHub token below.</p>')

    syncing = (
        '<p class="hint" style="margin-top:0">Notes and the settings above are saved into your own '
        'GitHub repository, encrypted with your dashboard password. Reading needs nothing; writing '
        'needs a token, pasted once per device and kept only in this browser.</p>'
        '<div class="noterow"><input type="password" id="ghtoken" placeholder="github_pat_…" '
        'autocomplete="off"><button type="button" id="tokensave">Save token</button></div>'
        '<p class="hint" id="tokenstatus"></p>')

    about = (
        f'<div class="zlist">'
        f'<div class="zrow"><span>App version</span><span class="num">{d["version"]}</span></div>'
        f'<div class="zrow"><span>Runs stored</span><span class="num">{len(d["runs"])}</span></div>'
        f'<div class="zrow"><span>With heart-rate detail</span><span class="num">{d["detailed"]}</span></div>'
        f'</div>'
        f'<div class="noterow"><button type="button" id="checkupdate">Check for update</button>'
        f'<span class="hint" id="updatestatus"></span></div>'
        f'<details class="tokenbox"><summary>Trouble? Clear this device</summary>'
        f'<p class="hint">Forgets the saved password, the token and anything not yet synced on '
        f'this device. Your runs and saved notes are not touched.</p>'
        f'<div class="noterow"><button type="button" id="clearlocal">Clear this device</button></div>'
        f'</details>')

    return (card(appearance, head="Appearance")
            + card(maps, head="Maps")
            + card(training, head="Training")
            + card(syncing, head="Saving and syncing")
            + card(about, head="About"))


def page_run(d):
    """An empty shell - the browser fills it in from RUNS when a run is opened."""
    return ('<a class="back" href="#/runs">← All runs</a>'
            '<div id="rundetail"><p class="sub">Loading…</p></div>')


def page_progress(d):
    max_hr, now = d["max_hr"], d["this_monday"]

    # ---- the headline numbers
    effort, band = d["week_effort"].get(now, 0), d["effort_band"].get(now)
    if band:
        where = ("below" if effort < band[0] else "above" if effort > band[1] else "inside")
        effort_note = f'usual {band[0]:.0f}–{band[1]:.0f} · {where}'
    else:
        effort_note = "this week so far"
    ef_now, ef_before = d["ef_now"], d["ef_before"]
    if ef_now and ef_before:
        change = (ef_now / ef_before - 1) * 100
        ef_note = f'{"+" if change >= 0 else "−"}{abs(change):.1f}% on the 4 weeks before'
    else:
        ef_note = "easy runs, 28 days"
    cad_text = f'{d["cad_now"]:.0f}' if d["cad_now"] else "–"
    ef_text = f"{ef_now:.2f}" if ef_now else "–"
    tiles = (
        '<div class="tiles four">'
        f'<div class="tile"><div class="label">Effort this week</div><div class="value">{effort}</div>'
        f'<div class="note">{effort_note}</div></div>'
        f'<div class="tile"><div class="label">Easy share</div><div class="value">{d["easy_share"]}</div>'
        f'<div class="note">28 days · goal ~80%</div></div>'
        f'<div class="tile"><div class="label">Metres per beat</div>'
        f'<div class="value">{ef_text}</div><div class="note">{ef_note}</div></div>'
        f'<div class="tile"><div class="label">Cadence</div>'
        f'<div class="value">{cad_text}<span class="unit">spm</span></div>'
        f'<div class="note">average, 28 days</div></div>'
        '</div>')

    # ---- the charts (drawn in the browser from window.PROG)
    load = (chart_slot("load", "Weekly training load")
            + '<p class="hint">Effort is heart-rate load: every minute of running counted 1 to 5 by how hard it '
              'was (Edwards\' method, from your strap second by second). The shaded band is your usual range - '
              '75–125% of the three weeks before. Building a little at a time and staying near the band is what '
              'lets the body absorb the work; a week far above it is where injuries come from.</p>')
    distance = chart_slot("dist", "Weekly distance")

    zones = (zone_bar(d["zone_seconds"]) +
             f'<p class="hint">Last 28 days, by moving time. The Norwegian method wants roughly 80% easy - '
             f'you are at {d["easy_share"]}.</p>')

    scatter = (chart_slot("shr", "Pace against heart rate, one dot per run", "Not enough runs with heart rate yet.") +
               '<p class="hint">One dot per run: heart rate across, pace up. Blue dots are the last four weeks, '
               'grey ones older. As you get fitter the cloud shifts up and left - faster at the same heart rate. '
               'Dots in the grey zone column are the runs to slow down next time.</p>')

    efficiency = (chart_slot("eff", "Metres per heartbeat on easy runs",
                             "Not enough easy runs yet - this fills in after a few weeks.") +
                  '<p class="hint">How far you travel for each heartbeat on easy and long runs. A rising line is '
                  'the aerobic engine improving - the main thing easy running is for. Heat, hills and tiredness '
                  'pull single runs down, so watch the line, not the dots.</p>')

    reps = (chart_slot("reps", "Threshold rep pace", "No threshold sessions with laps yet.") +
            f'<p class="hint">Average pace of the reps only - the laps at threshold heart rate '
            f'({bpm(max_hr, 82)}+ bpm) - so warm-up, jogs and cool-down do not blur it. Faster reps at the same '
            f'controlled heart rate is the clearest sign the threshold work is paying off.</p>')

    cadence = (chart_slot("cad", "Cadence per run", "No cadence recorded yet.") +
               '<p class="hint">Steps per minute, both feet, one dot per run: red under 160, amber 160–170, green '
               'above. There is no magic number - it rises naturally with speed, so threshold days sit higher than '
               'easy days. What helps is a slow drift upwards on easy runs over months: shorter, quicker steps land '
               'softer.</p>')

    rows = []
    for r, dc in d["long_drift"]:
        good = dc < 5
        w = max(3, min(max(dc, 0), 12) / 12 * 100)          # a negative drift is simply steady
        rows.append(
            f'<a class="driftrow" href="#/run/{r["id"]}"><span class="dname2">{r["_date"].strftime("%d.%m")} · '
            f'{fmt_hours(r["moving_time"])}</span>'
            f'<span class="dbar"><i class="{"dgood" if good else "dwarn"}" style="width:{w:.0f}%"></i><em></em></span>'
            f'<span class="dval">{dc:+.1f}%</span>'
            f'<span class="pill {"ok-pill" if good else "warn"}">{"✓ steady" if good else "! drifting"}</span></a>')
    drift = ((f'<div class="drift">{"".join(rows)}</div>' if rows else
              '<p class="sub">No long runs with heart-rate detail yet.</p>') +
             '<p class="hint">Aerobic decoupling compares the second half of a long run with the first: how much '
             'less distance each heartbeat buys once you are tired. Under 5% means your heart rate held steady for '
             'the pace - good endurance. Higher means the run was a touch too fast or too long for now. The first '
             '10 minutes are left out while heart rate settles. The marker on each bar is 5%.</p>')

    return (tiles
            + card(load, head="Training load")
            + card(scatter, head="Speed against heart rate")
            + card(efficiency, head="Aerobic efficiency")
            + card(zones, head="Time in zones")
            + card(reps, head="Threshold reps")
            + card(drift, head="Long runs: heart-rate drift")
            + card(cadence, head="Cadence")
            + card(distance, head="Weekly distance (km)"))


# ------------------------------------------------------------- 5. the shell

ICONS = {
    "home": '<path d="M3 10.6 12 3l9 7.6V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
    "plan": '<rect x="3.5" y="5" width="17" height="16" rx="2"/><path d="M8 3v4M16 3v4M3.5 10h17"/>',
    "runs": '<path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01"/>',
    "progress": '<path d="M3 17l5.5-5.5 3.5 3.5L21 6"/><path d="M15 6h6v6"/>',
    "map": '<path d="M9 3 3 5.5v15L9 18l6 3 6-2.5v-15L15 6z"/><path d="M9 3v15M15 6v15"/>',
    "settings": '<circle cx="12" cy="12" r="3.2"/><path d="M19.4 14.5a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5v.2a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H2a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.6-1.1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.5V2a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.5 1h.2a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.6 1z"/>',
}


def icon(name):
    return (f'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" '
            f'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{ICONS[name]}</svg>')


CSS = _web("app.css")

# The browser code, in load order. The files share one function scope, so a
# helper in core.js is visible to every file after it.
APP_FILES = ["core.js", "charts.js", "map.js", "run.js", "mappage.js", "progress.js", "plan.js", "settings.js",
             "boot.js"]
APP_JS = "(function () {\n" + "\n".join(_web(f) for f in APP_FILES) + "\n})();\n"
ROUTER = _web("router.js")


# --------------------------------------------------------------- assembling

def prepare(activities, config, details=None):
    """Everything the pages need, worked out once."""
    details = details or {}
    max_hr = int(config["max_hr"])
    runs = [a for a in activities if a.get("sport_type", a.get("type")) in RUN_TYPES]
    for r in runs:
        r["_zone"] = zone_of(r, max_hr)
        r["_date"] = run_date(r)
        r["_detail"] = details.get(r["id"])
        # real time per zone when the heart-rate stream is cached, otherwise the whole
        # run counts as its average zone
        hist = (r["_detail"] or {}).get("hrhist")
        r["_zone_seconds"] = (zones_from_histogram(hist, max_hr) if hist
                              else {r["_zone"]: r["moving_time"]})
        r["_kind"] = run_kind(r)
        r["_effort"] = effort_of(r, max_hr)
        hr = r.get("average_heartrate")
        # metres covered per heartbeat: rises as the aerobic engine improves
        r["_ef"] = (r["distance"] / r["moving_time"] * 60 / hr) if hr and r.get("moving_time") else None
        r["_cad"] = round(r["average_cadence"] * 2) if r.get("average_cadence") else None
    runs.sort(key=lambda r: r["_date"], reverse=True)

    today = date.fromisoformat(config["today"]) if config.get("today") else date.today()
    this_monday = today - timedelta(days=today.weekday())
    weeks = [this_monday - timedelta(weeks=i) for i in range(WEEKS_SHOWN - 1, -1, -1)]
    week_km = {w: defaultdict(float) for w in weeks}
    week_runs = defaultdict(list)
    for r in runs:
        monday = r["_date"].date() - timedelta(days=r["_date"].weekday())
        week_runs[monday].append(r)
        if monday in week_km:
            week_km[monday][r["_zone"]] += r["distance"] / 1000


    cutoff = datetime.combine(today - timedelta(days=27), datetime.min.time())
    recent = [r for r in runs if r["_date"] >= cutoff]
    zone_seconds = defaultdict(int)
    for r in recent:
        for zone, secs in r["_zone_seconds"].items():
            zone_seconds[zone] += secs
    hr_time = sum(v for k, v in zone_seconds.items() if k != "nohr")
    easy_share = f"{zone_seconds['easy'] / hr_time * 100:.0f}%" if hr_time else "-"

    # ---- progress: load, efficiency, cadence, threshold reps, decoupling
    week_effort = {w: sum(r["_effort"] or 0 for r in week_runs.get(w, [])) for w in weeks}
    effort_band = {}
    for i, w in enumerate(weeks):
        prior = [week_effort[v] for v in weeks[max(0, i - 3):i] if week_effort[v]]
        if len(prior) == 3:
            avg = sum(prior) / 3
            effort_band[w] = (avg * 0.75, avg * 1.25)
    d28 = today - timedelta(days=27)
    fmt_pc = lambda sec: f"{int(sec // 60)}:{int(sec % 60):02d}"
    dated = sorted(runs, key=lambda r: r["_date"])

    speed_hr = [(r["average_heartrate"], r["moving_time"] / (r["distance"] / 1000),
                 f'{escape(r["name"])}|{r["_date"].strftime("%d.%m.%Y")} · {r["distance"]/1000:.1f} km'
                 f'|{fmt_pc(r["moving_time"] / (r["distance"] / 1000))} /km at {r["average_heartrate"]:.0f} bpm',
                 r["_date"].date() >= d28)
                for r in dated if r.get("average_heartrate") and r["distance"] >= 2000]

    eff_points = [(r["_date"].date(), r["_ef"],
                   f'{r["_ef"]:.2f} m per beat|{escape(r["name"])} · {r["_date"].strftime("%d.%m")}'
                   f'|{fmt_pc(r["moving_time"] / (r["distance"] / 1000))} /km at {r["average_heartrate"]:.0f} bpm')
                  for r in dated if r["_ef"] and r["_kind"] in ("easy", "long") and r["distance"] >= 3000]

    cad_points = [(r["_date"].date(), r["_cad"],
                   f'{r["_cad"]} steps/min|{escape(r["name"])} · {r["_date"].strftime("%d.%m")}'
                   f'|{fmt_pc(r["moving_time"] / (r["distance"] / 1000))} /km')
                  for r in dated if r["_cad"] and r["_cad"] > 120]

    rep_points = []
    for r in dated:
        if r["_kind"] != "threshold":
            continue
        rp = rep_pace(r, max_hr)
        if rp:
            rep_points.append((r["_date"].date(), rp[0],
                               f'{fmt_pc(rp[0])} /km in the reps|{escape(r["name"])} · {r["_date"].strftime("%d.%m")}'
                               f'|Reps averaged {rp[1]:.0f} bpm'))

    long_drift = []
    for r in reversed(dated):
        if r["_kind"] == "long":
            dc = decoupling(r)
            if dc is not None:
                long_drift.append((r, dc))
        if len(long_drift) == 8:
            break

    def avg(xs):
        xs = [x for x in xs if x]
        return sum(xs) / len(xs) if xs else None
    ef_now = avg([r["_ef"] for r in recent if r["_kind"] in ("easy", "long")])
    ef_before = avg([r["_ef"] for r in runs if r["_kind"] in ("easy", "long")
                     and cutoff - timedelta(days=28) <= r["_date"] < cutoff])
    cad_now = avg([r["_cad"] for r in recent])

    return {
        "max_hr": max_hr, "runs": runs, "today": today, "this_monday": this_monday,
        "weeks": weeks, "week_km": week_km,
        "week_label": f"Week {today.isocalendar()[1]}",
        "this_week_km": sum(week_km[this_monday].values()),
        "avg4": sum(sum(week_km[w].values()) for w in weeks[-5:-1]) / 4,
        "runs28": len(recent), "zone_seconds": zone_seconds, "easy_share": easy_share,
        "detailed": sum(1 for r in runs if r["_detail"]),
        "latest": runs[0] if runs else None,
        "week_effort": week_effort, "effort_band": effort_band, "speed_hr": speed_hr,
        "eff_points": eff_points, "cad_points": cad_points, "rep_points": rep_points,
        "long_drift": long_drift, "ef_now": ef_now, "ef_before": ef_before, "cad_now": cad_now,
        "updated": config.get("updated", datetime.now().strftime("%d.%m.%Y %H:%M")),
        "version": config.get("version", "dev"),
    }


def render(activities, config, details=None, notes=None, plan=None):
    d = prepare(activities, config, details)
    heads = {
        "home": ("Training", f'{d["week_label"]} · updated {d["updated"]}'),
        "plan": ("Plan", "Three runs a week: two at threshold, one long and easy · Marius Bakken's method"),
        "runs": ("Runs", "Your runs from Strava, last 140 days"),
        "map": ("Map", "Every run on one map"),
        "progress": ("Progress", f'Max heart rate {d["max_hr"]} bpm · updated {d["updated"]}'),
        "settings": ("Settings", "Appearance is per device; training settings sync to your other devices"),
    }
    bodies = {"home": page_home(d), "plan": page_plan(d), "runs": page_runs(d),
              "map": page_map(d), "progress": page_progress(d),
              "settings": page_settings(d), "run": page_run(d)}
    sections = "".join(
        f'<section class="page" id="{key}" aria-label="{label}">'
        + ("" if key == "run" else
           f'<h1>{heads[key][0]}</h1><p class="sub">{heads[key][1]}</p>')
        + bodies[key] + '</section>'
        for key, label in SECTIONS)
    conf = {"maxhr": d["max_hr"], "zones": [[k, label, lo, hi] for k, label, lo, hi, _ in ZONES],
            "names": NAMES, "colors": COLORS, "order": ORDER, "days": WEEKDAYS,
            "repo": config.get("repo", ""), "version": d["version"],
            "today": d["today"].isoformat()}
    # "</" is escaped so a run named "</script>" cannot break out of the tag
    blob = lambda obj: json.dumps(obj, separators=(",", ":")).replace("</", "<\\/")
    data = (f'<script>window.CONF={blob(conf)};window.RUNS={blob(runs_payload(d))};'
            f'window.NOTES={blob(notes or {})};'
            f'window.PLAN={blob({"standard": standard_plan(d["today"]), "saved": plan})};'
            f'window.PROG={blob(progress_payload(d))};</script>')
    nav = "".join(f'<a href="#/{key}">{icon(key)}<span>{label}</span></a>' for key, label in PAGES)

    return f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#f2f4f6">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="Trening">
<link rel="manifest" href="manifest.webmanifest">
<link rel="icon" href="icon.png">
<link rel="apple-touch-icon" href="icon.png">
<title>Training Dashboard</title>
<script>
  // apply the saved appearance before anything is painted, so there is no flash
  try {{
    var t = localStorage.getItem('pref-theme');
    if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
  }} catch (e) {{}}
</script>
<style>{CSS}</style></head>
<body>
<nav class="tabs" aria-label="Sections"><span class="brand"><i></i>Trening</span>{nav}</nav>
<div id="update" hidden><span>Update ready</span><button type="button" id="updatego">Reload</button></div>
<main>{sections}</main>
<div id="tip"></div>
{data}
<script>{APP_JS}</script>
<script>{ROUTER}</script>
</body></html>"""
