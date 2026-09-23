"""
Turns a list of Strava activities into the dashboard.

The dashboard is one HTML page with four sub-pages - Home, Plan, Runs, Progress -
and a menu (bottom tab bar on a phone, sidebar on a desktop). Everything is
rendered here and shipped in one encrypted file, so switching pages is instant
and works offline once opened.

Layout of this file:
  1. Settings and small helpers
  2. The training plan (week structure, progression, matching runs to sessions)
  3. Charts (hand-built inline SVG)
  4. The four pages
  5. Shell: CSS, menu, router
"""
import json
from collections import defaultdict
from datetime import datetime, timedelta, date
from html import escape
from pathlib import Path

import strava_cache

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

# The threshold session gets longer every 2 weeks.
PROGRESSION = [
    ("6 × 3 min", "1 min easy jog"),
    ("5 × 5 min", "1 min easy jog"),
    ("4 × 7 min", "1 min easy jog"),
    ("3 × 10 min", "1½ min easy jog"),
]

# Which weekday each session lands on (Monday = 0). Override in config.json.
DEFAULT_PLAN_DAYS = {"threshold": 1, "easy": 3, "long": 6}
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

def week_number_for(monday, plan_start):
    """Plan week 1 is the week of plan_start; anything before it counts as week 1."""
    return max((monday - plan_start).days // 7 + 1, 1)


def plan_week_number(config, today):
    """(week number, the Monday the plan starts, True if the plan has not started yet)."""
    start = date.fromisoformat(config.get("plan_start", today.isoformat()))
    start -= timedelta(days=start.weekday())
    monday = today - timedelta(days=today.weekday())
    return week_number_for(monday, start), start, monday < start


def threshold_step(week_no):
    """The threshold session for a plan week, plus which step of the progression it is."""
    step = min((week_no - 1) // 2, len(PROGRESSION) - 1)
    return step, PROGRESSION[step]


def week_sessions(week_no, monday, max_hr, config):
    """The three planned sessions of a week, as dicts, ordered by day."""
    days = {**DEFAULT_PLAN_DAYS, **config.get("plan_days", {})}
    _, (session, rest) = threshold_step(week_no)
    thr_lo, thr_hi = bpm(max_hr, 82), bpm(max_hr, 88) - 1
    easy_max = bpm(max_hr, 75)
    plan = [
        {"key": "threshold", "zone": "threshold", "title": f"Threshold session: {session}",
         "short": "Thr", "long_name": "Threshold", "reps": session, "target": f"{thr_lo}–{thr_hi} bpm",
         "detail": f"15 min easy warm-up, then {session} at <b>{thr_lo}–{thr_hi} bpm</b> with {rest} "
                   f"between, then 10 min easy. Stay in the lower half of that range - it should feel "
                   f"comfortably hard, like you could do one more rep. Heart rate rises slowly, so "
                   f"don't chase the number in the first minute."},
        {"key": "easy", "zone": "easy", "title": "Easy run: 40–50 min",
         "short": "Easy", "long_name": "Easy run", "reps": "40–50 min", "target": f"under {easy_max} bpm",
         "detail": f"Heart rate <b>under {easy_max} bpm</b> the whole way. Slow down or walk the hills "
                   f"if you need to. This should feel almost too easy."},
        {"key": "long", "zone": "easy", "title": "Long easy run: 60–75 min",
         "short": "Long", "long_name": "Long run", "reps": "60–75 min", "target": f"under {easy_max} bpm",
         "detail": f"Same rule: <b>under {easy_max} bpm</b>. This builds the engine that makes the "
                   f"threshold work pay off. Time on your feet matters more than pace."},
    ]
    for s in plan:
        s["weekday"] = days.get(s["key"], DEFAULT_PLAN_DAYS[s["key"]])
        s["date"] = monday + timedelta(days=s["weekday"])
        s["run"] = None
    return sorted(plan, key=lambda s: s["weekday"])


def match_runs_to_sessions(sessions, runs):
    """Tie the week's actual runs to the planned sessions. Returns the leftovers."""
    left = sorted(runs, key=lambda r: r["_date"])
    for s in sessions:                                   # 1. same weekday wins
        for r in left:
            if r["_date"].weekday() == s["weekday"]:
                s["run"], left = r, [x for x in left if x is not r]
                break
    for s in sessions:                                   # 2. a quality run fills the threshold slot
        if s["key"] == "threshold" and not s["run"]:
            for r in left:
                if r["_zone"] in ("threshold", "hard"):
                    s["run"], left = r, [x for x in left if x is not r]
                    break
    for s in sorted(sessions, key=lambda s: s["key"] != "long"):   # 3. longest leftover -> long run
        if not s["run"] and left:
            pick = max(left, key=lambda r: r["moving_time"]) if s["key"] == "long" else left[0]
            s["run"], left = pick, [x for x in left if x is not pick]
    return left


def next_session(sessions, today):
    """The session to point at on the front page: today's, then the next one, then anything missed."""
    for s in sessions:
        if not s["run"] and s["date"] == today:
            return s, "today"
    for s in sessions:
        if not s["run"] and s["date"] > today:
            return s, "upcoming"
    for s in sessions:
        if not s["run"] and s["date"] < today:
            return s, "missed"
    return None, "done"


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


# ----------------------------------------------------------------- 3. charts

def weekly_chart(weeks, week_km):
    """Stacked bars: one per week, split by the zone each run fell in."""
    W, H, left, bottom, top = 760, 260, 44, 30, 12
    plot_w, plot_h = W - left - 8, H - bottom - top
    peak = max([sum(v.values()) for v in week_km.values()] + [10])
    step = 10 if peak <= 60 else 20
    y_max = (int(peak // step) + 1) * step
    slot = plot_w / len(weeks)
    bar_w = min(28, slot * 0.6)
    y = lambda km: top + plot_h - km / y_max * plot_h
    svg = []
    for t in range(0, y_max + 1, step):
        svg.append(f'<line x1="{left}" x2="{W-8}" y1="{y(t):.1f}" y2="{y(t):.1f}" class="grid"/>'
                   f'<text x="{left-6}" y="{y(t)+4:.1f}" class="tick" text-anchor="end">{t}</text>')
    for i, w in enumerate(weeks):
        x = left + i * slot + (slot - bar_w) / 2
        total = sum(week_km[w].values())
        segs = [(k, week_km[w][k]) for k in ORDER if week_km[w][k] > 0]
        tip = f"Week of {w.strftime('%d.%m')}: {total:.1f} km" + "".join(
            f"|{NAMES[k]}: {v:.1f} km" for k, v in segs)
        svg.append(f'<g class="wk" data-tip="{escape(tip)}">'
                   f'<rect x="{left + i*slot:.1f}" y="{top}" width="{slot:.1f}" height="{plot_h}" class="hit"/>')
        base = 0.0
        for n, (k, v) in enumerate(segs):
            y0, y1 = y(base), y(base + v)
            last = n == len(segs) - 1
            h = max(y0 - y1 - (0 if last else 2), 1)
            svg.append(f'<rect x="{x:.1f}" y="{y1:.1f}" width="{bar_w:.1f}" height="{h:.1f}" '
                       f'rx="{4 if last else 0}" class="s{COLORS[k]}"/>')
            if last and h > 4:  # square off the bottom corners of the rounded top segment
                svg.append(f'<rect x="{x:.1f}" y="{y1 + h - 4:.1f}" width="{bar_w:.1f}" height="4" '
                           f'class="s{COLORS[k]}"/>')
            base += v
        if (len(weeks) - 1 - i) % 3 == 0:
            anchor = "start" if i == 0 else "end" if i == len(weeks) - 1 else "middle"
            svg.append(f'<text x="{x + bar_w/2:.1f}" y="{H-8}" class="tick" text-anchor="{anchor}">'
                       f'{w.strftime("%d.%m")}</text>')
        svg.append("</g>")
    svg.append(f'<line x1="{left}" x2="{W-8}" y1="{y(0):.1f}" y2="{y(0):.1f}" class="axis"/>')
    return (f'<svg viewBox="0 0 {W} {H}" role="img" aria-label="Weekly running distance by intensity">'
            f'{"".join(svg)}</svg>')


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


def trend_chart(points, label):
    """Small line chart. points = [(x-label, value, tooltip)], value in seconds per km."""
    if len(points) < 2:
        return '<p class="sub">Not enough runs yet - this fills in after a few weeks.</p>'
    W, H, left, bottom, top = 760, 200, 66, 30, 14
    plot_w, plot_h = W - left - 10, H - bottom - top
    vals = [p[1] for p in points]
    lo, hi = min(vals), max(vals)
    pad = max((hi - lo) * 0.25, 8)
    lo, hi = lo - pad, hi + pad
    x = lambda i: left + (plot_w * i / (len(points) - 1))
    y = lambda v: top + plot_h - (v - lo) / (hi - lo) * plot_h
    svg = []
    for t in range(4):
        v = lo + (hi - lo) * t / 3
        svg.append(f'<line x1="{left}" x2="{W-10}" y1="{y(v):.1f}" y2="{y(v):.1f}" class="grid"/>'
                   f'<text x="{left-6}" y="{y(v)+4:.1f}" class="tick" text-anchor="end">'
                   f'{int(v//60)}:{int(v%60):02d}</text>')
    line = " ".join(f"{x(i):.1f},{y(v):.1f}" for i, (_, v, _) in enumerate(points))
    svg.append(f'<polyline points="{line}" class="line"/>')
    for i, (lab, v, tip) in enumerate(points):
        svg.append(f'<g class="wk" data-tip="{escape(tip)}">'
                   f'<rect x="{x(i)-14:.1f}" y="{top}" width="28" height="{plot_h}" class="hit"/>'
                   f'<circle cx="{x(i):.1f}" cy="{y(v):.1f}" r="4" class="pt"/></g>')
        if i % max(1, len(points) // 6) == 0 or i == len(points) - 1:
            anchor = "start" if i == 0 else "end" if i == len(points) - 1 else "middle"
            svg.append(f'<text x="{x(i):.1f}" y="{H-8}" class="tick" text-anchor="{anchor}">{lab}</text>')
    return (f'<svg viewBox="0 0 {W} {H}" role="img" aria-label="{escape(label)}">{"".join(svg)}</svg>')


# ------------------------------------------------------------------ 4. pages

def page_home(d):
    max_hr, today = d["max_hr"], d["today"]
    nxt, state = d["next"], d["next_state"]

    # ---- next session
    if nxt:
        when = f'{day_word(nxt["date"], today)} · {nxt["date"].strftime("%d.%m")}'
        badge = {"today": '<span class="pill hot">Today</span>',
                 "upcoming": '<span class="pill">Next up</span>',
                 "missed": '<span class="pill warn">Missed - fit it in</span>'}[state]
        next_body = (f'<div class="nexthead"><span class="when">{when}</span>{badge}</div>'
                     f'<h3>{nxt["title"]}</h3>'
                     f'<p class="target">Target heart rate: <b>{nxt["target"]}</b></p>'
                     f'<p class="detail">{nxt["detail"]}</p>')
    else:
        next_body = ('<div class="nexthead"><span class="when">This week</span>'
                     '<span class="pill ok-pill">All done ✓</span></div>'
                     '<h3>Week complete - rest up</h3>'
                     '<p class="detail">All three sessions are in the bag. Easy days, sleep and food '
                     'are what turn them into fitness. The next week starts Monday.</p>')
    if d["before_start"]:
        days = d["days_to_start"]
        when = "tomorrow" if days == 1 else f"in {days} days" if days else "today"
        next_body += (f'<p class="hint">Week 1 of the written plan starts Monday '
                      f'{d["plan_start"].strftime("%d.%m.%Y")} ({when}). Until then this is a warm-up '
                      f'week - same three sessions, no pressure.</p>')

    # ---- this week's schedule
    cells = []
    by_day = {s["weekday"]: s for s in d["sessions"]}
    extra_by_day = defaultdict(list)
    for r in d["extra_runs"]:
        extra_by_day[r["_date"].weekday()].append(r)
    for i in range(7):
        day = d["this_monday"] + timedelta(days=i)
        s = by_day.get(i)
        extras = extra_by_day.get(i, [])
        is_today = " today" if day == today else ""
        if s and s["run"]:
            run = s["run"]
            cells.append(f'<div class="day done{is_today}"><span class="dname">{SHORT_DAYS[i]}</span>'
                         f'<span class="dmark">✓</span>'
                         f'<span class="dlabel">{run["distance"]/1000:.1f}</span>'
                         f'<span class="dlabel wide">{run["distance"]/1000:.1f} km</span></div>')
        elif s:
            late = " late" if day < today else ""
            cells.append(f'<div class="day planned{late}{is_today}"><span class="dname">{SHORT_DAYS[i]}</span>'
                         f'<span class="dmark">○</span>'
                         f'<span class="dlabel">{s["short"]}</span>'
                         f'<span class="dlabel wide">{s["long_name"]}</span></div>')
        elif extras:
            cells.append(f'<div class="day done{is_today}"><span class="dname">{SHORT_DAYS[i]}</span>'
                         f'<span class="dmark">✓</span>'
                         f'<span class="dlabel">{extras[0]["distance"]/1000:.1f}</span>'
                         f'<span class="dlabel wide">{extras[0]["distance"]/1000:.1f} km</span></div>')
        else:
            cells.append(f'<div class="day rest{is_today}"><span class="dname">{SHORT_DAYS[i]}</span>'
                         f'<span class="dmark">·</span><span class="dlabel">Rest</span>'
                         f'<span class="dlabel wide">Rest</span></div>')
    done = sum(1 for s in d["sessions"] if s["run"])
    extra_note = f' · {len(d["extra_runs"])} extra run{"s" if len(d["extra_runs"]) != 1 else ""}' if d["extra_runs"] else ""
    week_body = (f'<p class="sub tight">{d["week_label"]} · {done} of 3 sessions done{extra_note}</p>'
                 f'<div class="week">{"".join(cells)}</div>')

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

    return (card(next_body, cls="hero")
            + card(week_body, head="This week", link=("plan", "Plan"))
            + tiles
            + card(latest_body, head="Latest run", link=("runs", "All runs")))


def page_plan(d):
    max_hr = d["max_hr"]
    rows = []
    for s in d["sessions"]:
        done = s["run"] is not None
        mark = '<span class="ok">✓</span>' if done else '<span class="todo">○</span>'
        extra = ""
        if done:
            r = s["run"]
            extra = (f'<p class="did">Done: {escape(r["name"])} · {r["distance"]/1000:.1f} km · '
                     f'{fmt_time(r["moving_time"])} · {fmt_pace(r["moving_time"], r["distance"])} /km · '
                     f'{hr_text(r)} bpm {dot(r["_zone"])}</p>')
        rows.append(f'<div class="session">{mark}<div>'
                    f'<span class="when">{WEEKDAYS[s["weekday"]]} {s["date"].strftime("%d.%m")}</span>'
                    f'<b>{s["title"]}</b><p>{s["detail"]}</p>{extra}</div></div>')
    span = f'{d["this_monday"].strftime("%d.%m")}–{(d["this_monday"] + timedelta(days=6)).strftime("%d.%m.%Y")}'
    title = ("Warm-up week before the plan starts" if d["before_start"]
             else f'Week {d["week_no"]} of the plan')
    week_body = (f'<p class="sub tight">{title} · {span}</p>'
                 f'<div class="plan">{"".join(rows)}</div>'
                 f'<p class="hint">Keep at least one day between runs. If a day does not work, move it - '
                 f'three sessions in the week matters more than which days they land on.</p>')

    step_now, _ = threshold_step(d["week_no"])
    steps = "".join(
        f'<div class="step{" now" if i == step_now else ""}">'
        f'<span class="pill">Week {i*2+1}–{i*2+2}</span><b>{reps}</b>'
        f'<span class="rest">{rest} between</span>'
        f'{"<span class=nowtag>You are here</span>" if i == step_now else ""}</div>'
        for i, (reps, rest) in enumerate(PROGRESSION))
    prog_body = (f'<div class="steps">{steps}</div>'
                 f'<p class="hint">The threshold session grows every two weeks. Repeat a step instead of '
                 f'moving on if the last one felt hard or the heart rate crept above '
                 f'{bpm(max_hr, 88) - 1} bpm.</p>')

    ahead = []
    for n in range(1, 6):
        monday = d["this_monday"] + timedelta(weeks=n)
        wk = week_number_for(monday, d["plan_start"])
        _, (reps, _) = threshold_step(wk)
        ahead.append(f'<div class="zrow"><span>Week {wk} · from {monday.strftime("%d.%m")}</span>'
                     f'<span class="num">{reps}</span></div>')
    ahead_body = (f'<div class="zlist">{"".join(ahead)}</div>'
                  f'<p class="hint">Editing the plan in the app (and writing your own sessions) is the next '
                  f'thing on the list. For now the plan follows the progression above automatically.</p>')

    zone_rows = "".join(
        f'<tr><td class="wrap">{dot(k)}<b>{label}</b><div class="desc">{why}</div></td>'
        f'<td class="num">{zone_range(max_hr, lo, hi)}</td></tr>' for k, label, lo, hi, why in ZONES)
    zones_body = (f'<div class="scroll"><table><tr><th>Zone</th><th>Heart rate (bpm)</th></tr>'
                  f'{zone_rows}</table></div>'
                  f'<p class="hint">Based on a max heart rate of {max_hr} bpm.</p>')

    return (card(week_body, head="This week")
            + card(prog_body, head="Threshold progression")
            + card(ahead_body, head="Weeks ahead")
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
            "z": r["_zone"],
            "poly": (r.get("map") or {}).get("summary_polyline") or "",
            "zs": {k: round(v) for k, v in r["_zone_seconds"].items() if v},
        }
        if det:
            item |= {"t": det.get("t") or [], "d": det.get("d") or [],
                     "hs": det.get("hr") or [], "sp": det.get("sp") or [],
                     "al": det.get("alt") or [],
                     "laps": det.get("laps") or [], "sl": det.get("splits") or []}
        out.append(item)
    return out


def page_map(d):
    """
    Placeholder. The plan is a full-screen map holding every run at once plus a
    heat map of the ground he covers most, reusing SlippyMap and the route
    styles from the run page - so it waits until those are settled.
    """
    return (
        '<section class="card"><h2>Not built yet</h2>'
        '<p class="sub">This is where every run will sit on one map, with a heat map of '
        'the roads and trails you run most often. It will use the same map and route '
        'styles as a single run, so it is waiting until those are exactly right.</p>'
        '<p class="sub">For now, open any run from '
        '<a href="#/runs">Runs</a> to see its route.</p></section>')


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
        '<button type="button" data-route="elev">Height</button></div>'
        '<p class="hint">What a map opens with. You can switch on the map itself, and the 3D button '
        'tilts it over the real terrain.</p>')

    training = (
        f'<label class="field"><span>Maximum heart rate</span>'
        f'<input type="number" id="setmaxhr" min="120" max="230" value="{d["max_hr"]}"></label>'
        f'<p class="hint">Every zone is worked out from this. {bpm(d["max_hr"], 82)}–'
        f'{bpm(d["max_hr"], 88) - 1} bpm is your threshold band today.</p>'
        f'<label class="field"><span>Plan week 1 starts</span>'
        f'<input type="date" id="setstart" value="{d["plan_start"].isoformat()}"></label>'
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
    used = [k for k in ORDER if any(d["week_km"][w][k] for w in d["weeks"])] or ["easy"]
    legend = "".join(f'<span><i class="s{COLORS[k]}"></i>{NAMES[k]}</span>' for k in used)
    volume = (f'<div class="legend">{legend}</div>{weekly_chart(d["weeks"], d["week_km"])}'
              f'<p class="hint">Each bar is one week, coloured by the zone each run fell in. '
              f'Blue should dominate.</p>')

    zones = (zone_bar(d["zone_seconds"]) +
             f'<p class="hint">Last 28 days, by moving time. The Norwegian method wants roughly 80% easy - '
             f'you are at {d["easy_share"]}.</p>')

    eff = (trend_chart(d["easy_points"], "Easy-run pace over time") +
           f'<p class="hint">Average pace of your easy runs each week, at an average heart rate that stays '
           f'under {bpm(d["max_hr"], 75)} bpm. If the line drifts down while the heart rate stays put, '
           f'the engine is getting better.</p>')

    thr = (trend_chart(d["thr_points"], "Threshold-session pace over time") +
           f'<p class="hint">Your threshold sessions, whole-session pace including warm-up and cool-down. '
           f'Same heart rate at a faster pace is the clearest sign the threshold work is paying off.</p>')

    return (card(volume, head="Weekly distance (km)")
            + card(zones, head="Time in zones")
            + card(eff, head="Easy pace at easy heart rate")
            + card(thr, head="Threshold sessions"))


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
APP_FILES = ["core.js", "charts.js", "map.js", "run.js", "mappage.js", "plan.js", "settings.js", "boot.js"]
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

    week_no, plan_start, before_start = plan_week_number(config, today)
    sessions = week_sessions(week_no, this_monday, max_hr, config)
    this_week_runs = sorted(week_runs[this_monday], key=lambda r: r["_date"])
    extra_runs = match_runs_to_sessions(sessions, this_week_runs)
    nxt, next_state = next_session(sessions, today)

    cutoff = datetime.combine(today - timedelta(days=27), datetime.min.time())
    recent = [r for r in runs if r["_date"] >= cutoff]
    zone_seconds = defaultdict(int)
    for r in recent:
        for zone, secs in r["_zone_seconds"].items():
            zone_seconds[zone] += secs
    hr_time = sum(v for k, v in zone_seconds.items() if k != "nohr")
    easy_share = f"{zone_seconds['easy'] / hr_time * 100:.0f}%" if hr_time else "-"

    # pace trends: easy running per week, and each threshold session
    easy_points = []
    for w in weeks[-10:]:
        easy = [r for r in week_runs.get(w, []) if r["_zone"] == "easy" and r["distance"]]
        if len(easy) < 1:
            continue
        secs = sum(r["moving_time"] for r in easy)
        km = sum(r["distance"] for r in easy) / 1000
        hrs = [r["average_heartrate"] for r in easy if r.get("average_heartrate")]
        pace = secs / km
        tip = (f"Week of {w.strftime('%d.%m')}: {int(pace//60)}:{int(pace%60):02d} /km"
               f"|{len(easy)} easy run{'s' if len(easy) != 1 else ''}, {km:.1f} km"
               + (f"|Average {sum(hrs)/len(hrs):.0f} bpm" if hrs else ""))
        easy_points.append((w.strftime("%d.%m"), pace, tip))

    thr_points = []
    for r in sorted([r for r in runs if r["_zone"] in ("threshold", "hard") and r["distance"]],
                    key=lambda r: r["_date"])[-12:]:
        pace = r["moving_time"] / (r["distance"] / 1000)
        tip = (f"{r['_date'].strftime('%d.%m.%Y')}: {int(pace//60)}:{int(pace%60):02d} /km"
               f"|{r['distance']/1000:.1f} km, {fmt_time(r['moving_time'])}"
               f"|Average {hr_text(r)} bpm")
        thr_points.append((r["_date"].strftime("%d.%m"), pace, tip))

    return {
        "max_hr": max_hr, "runs": runs, "today": today, "this_monday": this_monday,
        "weeks": weeks, "week_km": week_km, "week_no": week_no, "plan_start": plan_start,
        "before_start": before_start,
        "week_label": "Warm-up week" if before_start else f"Week {week_no}",
        "days_to_start": max((plan_start - today).days, 0),
        "sessions": sessions, "extra_runs": extra_runs, "next": nxt, "next_state": next_state,
        "this_week_km": sum(week_km[this_monday].values()),
        "avg4": sum(sum(week_km[w].values()) for w in weeks[-5:-1]) / 4,
        "runs28": len(recent), "zone_seconds": zone_seconds, "easy_share": easy_share,
        "detailed": sum(1 for r in runs if r["_detail"]),
        "latest": runs[0] if runs else None,
        "easy_points": easy_points, "thr_points": thr_points,
        "updated": config.get("updated", datetime.now().strftime("%d.%m.%Y %H:%M")),
        "version": config.get("version", "dev"),
        "plan_days": {**DEFAULT_PLAN_DAYS, **config.get("plan_days", {})},
    }


def render(activities, config, details=None, notes=None):
    d = prepare(activities, config, details)
    heads = {
        "home": ("Training", f'{d["week_label"]} · updated {d["updated"]}'),
        "plan": ("Plan", "3 runs a week: one threshold session, two easy · Norwegian method"),
        "runs": ("Runs", "Your runs from Strava, last 140 days"),
        "map": ("Map", "Every route on one map"),
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
            "planDays": d["plan_days"], "maxhrSet": d["max_hr"], "today": d["today"].isoformat(),
            "planStart": d["plan_start"].isoformat()}
    # "</" is escaped so a run named "</script>" cannot break out of the tag
    blob = lambda obj: json.dumps(obj, separators=(",", ":")).replace("</", "<\\/")
    data = (f'<script>window.CONF={blob(conf)};window.RUNS={blob(runs_payload(d))};'
            f'window.NOTES={blob(notes or {})};</script>')
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
