"""Turns a list of Strava activities into the dashboard HTML page."""
from collections import defaultdict
from datetime import datetime, timedelta, date
from html import escape

RUN_TYPES = {"Run", "TrailRun", "VirtualRun"}
WEEKS_SHOWN = 16

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

# 3 runs a week: 1 threshold session + 2 easy runs. Threshold session progresses every 2 weeks.
PROGRESSION = [
    ("6 × 3 min", "1 min easy jog"),
    ("5 × 5 min", "1 min easy jog"),
    ("4 × 7 min", "1 min easy jog"),
    ("3 × 10 min", "1½ min easy jog"),
]


def run_date(run):
    return datetime.fromisoformat(run["start_date_local"].replace("Z", ""))


def zone_of(run, max_hr):
    hr = run.get("average_heartrate")
    if not hr:
        return "nohr"
    pct = hr / max_hr * 100
    for key, _, lo, hi, _ in ZONES:
        if lo <= pct < hi:
            return key
    return "hard"


def fmt_pace(seconds, meters):
    if not meters:
        return "-"
    s = seconds / (meters / 1000)
    return f"{int(s // 60)}:{int(s % 60):02d}"


def fmt_time(seconds):
    h, m = divmod(int(seconds) // 60, 60)
    return f"{h} h {m:02d} min" if h else f"{m} min"


def hr_text(run):
    hr = run.get("average_heartrate")
    return f"{hr:.0f}" if hr else "-"


def bpm(max_hr, pct):
    return round(max_hr * pct / 100)


def weekly_chart(weeks, week_km):
    W, H, left, bottom, top = 760, 260, 40, 28, 12
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
        if (len(weeks) - 1 - i) % 2 == 0:
            svg.append(f'<text x="{x + bar_w/2:.1f}" y="{H-8}" class="tick" text-anchor="middle">'
                       f'{w.strftime("%d.%m")}</text>')
        svg.append("</g>")
    svg.append(f'<line x1="{left}" x2="{W-8}" y1="{y(0):.1f}" y2="{y(0):.1f}" class="axis"/>')
    return (f'<svg viewBox="0 0 {W} {H}" role="img" aria-label="Weekly running distance by intensity">'
            f'{"".join(svg)}</svg>')


def plan_card(config, today, this_week_runs, max_hr):
    start = date.fromisoformat(config.get("plan_start", today.isoformat()))
    start -= timedelta(days=start.weekday())
    week_no = max((today - start).days // 7 + 1, 1)
    session, rest = PROGRESSION[min((week_no - 1) // 2, len(PROGRESSION) - 1)]
    thr_lo, thr_hi = bpm(max_hr, 82), bpm(max_hr, 88) - 1
    easy_max = bpm(max_hr, 75)

    done = len(this_week_runs)
    quality_done = any(r["_zone"] in ("threshold", "hard") for r in this_week_runs)
    status = f"{min(done, 3)} of 3 runs done this week"
    if done > 3:
        status += f" (+{done - 3} extra)"
    check = lambda ok: '<span class="ok">✓</span>' if ok else '<span class="todo">○</span>'
    easy_done = done - (1 if quality_done else 0)

    return f"""
<div class="card">
  <h2>This week's plan <span class="pill">Week {week_no}</span></h2>
  <p class="sub" style="margin-bottom:12px">{status}</p>
  <div class="plan">
    <div class="session">{check(quality_done)}<div><b>Threshold session: {session}</b>
      <p>15 min easy warm-up, then {session} at <b>{thr_lo}–{thr_hi} bpm</b> with {rest} between, then 10 min easy.
      Stay in the lower half of that range. It should feel comfortably hard, like you could do one more rep.
      Heart rate rises slowly, so don't chase the number in the first minute.</p></div></div>
    <div class="session">{check(easy_done >= 1)}<div><b>Easy run: 40–50 min</b>
      <p>Heart rate <b>under {easy_max} bpm</b> the whole way. Slow down or walk the hills if needed.</p></div></div>
    <div class="session">{check(easy_done >= 2)}<div><b>Long easy run: 60–75 min</b>
      <p>Same rule: under {easy_max} bpm. This builds the engine that makes the threshold work pay off.</p></div></div>
  </div>
  <p class="sub" style="margin:12px 0 0">Put at least one day between runs. The threshold session gets longer every 2 weeks:
  6×3 → 5×5 → 4×7 → 3×10 min. Repeat a step if it felt hard.</p>
</div>"""


def render(activities, config):
    max_hr = int(config["max_hr"])
    runs = [a for a in activities if a.get("sport_type", a.get("type")) in RUN_TYPES]
    for r in runs:
        r["_zone"] = zone_of(r, max_hr)
        r["_date"] = run_date(r)
    runs.sort(key=lambda r: r["_date"], reverse=True)

    today = date.fromisoformat(config["today"]) if config.get("today") else date.today()
    this_monday = today - timedelta(days=today.weekday())
    weeks = [this_monday - timedelta(weeks=i) for i in range(WEEKS_SHOWN - 1, -1, -1)]
    week_km = {w: defaultdict(float) for w in weeks}
    for r in runs:
        d = r["_date"].date()
        monday = d - timedelta(days=d.weekday())
        if monday in week_km:
            week_km[monday][r["_zone"]] += r["distance"] / 1000

    this_week_runs = [r for r in runs if r["_date"].date() >= this_monday]
    this_week_km = sum(week_km[this_monday].values())
    avg4 = sum(sum(week_km[w].values()) for w in weeks[-5:-1]) / 4
    cutoff = datetime.combine(today - timedelta(days=28), datetime.min.time())
    recent = [r for r in runs if r["_date"] >= cutoff]
    hr_time = sum(r["moving_time"] for r in recent if r["_zone"] != "nohr")
    easy_time = sum(r["moving_time"] for r in recent if r["_zone"] == "easy")
    easy_share = f"{easy_time / hr_time * 100:.0f}%" if hr_time else "-"

    used = [k for k in ORDER if any(week_km[w][k] for w in weeks)] or ["easy"]
    legend = "".join(f'<span><i class="s{COLORS[k]}"></i>{NAMES[k]}</span>' for k in used)

    def zone_range(lo, hi):
        if lo == 0:
            return f"under {bpm(max_hr, hi)}"
        if hi > 100:
            return f"{bpm(max_hr, lo)}+"
        return f"{bpm(max_hr, lo)}–{bpm(max_hr, hi) - 1}"

    zone_rows = "".join(
        f'<tr><td class="wrap"><i class="dot s{COLORS[k]}"></i><b>{label}</b><div class="desc">{why}</div></td>'
        f'<td class="num">{zone_range(lo, hi)}</td></tr>' for k, label, lo, hi, why in ZONES)

    run_rows = "".join(
        f'<tr><td class="num">{r["_date"].strftime("%a %d.%m")}</td><td class="wrap">{escape(r["name"])}</td>'
        f'<td class="num">{r["distance"]/1000:.1f}</td><td class="num">{fmt_time(r["moving_time"])}</td>'
        f'<td class="num">{fmt_pace(r["moving_time"], r["distance"])}</td><td class="num">{hr_text(r)}</td>'
        f'<td><i class="dot s{COLORS[r["_zone"]]}"></i>{NAMES[r["_zone"]]}</td></tr>'
        for r in runs[:30]) or '<tr><td colspan="7">No runs yet.</td></tr>'

    return TEMPLATE.format(
        updated=config.get("updated", datetime.now().strftime("%d.%m.%Y %H:%M")),
        this_week=f"{this_week_km:.1f}", avg4=f"{avg4:.1f}", runs28=len(recent),
        easy_share=easy_share, easy_ceiling=bpm(max_hr, 75), max_hr=max_hr,
        plan=plan_card(config, today, this_week_runs, max_hr),
        chart=weekly_chart(weeks, week_km), legend=legend,
        zone_rows=zone_rows, run_rows=run_rows)


TEMPLATE = """<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="#2a78d6">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="Trening">
<link rel="manifest" href="manifest.webmanifest">
<link rel="icon" href="icon.png">
<link rel="apple-touch-icon" href="icon.png">
<title>Training Dashboard</title>
<style>
:root {{
  color-scheme: light;
  --page:#f9f9f7; --surface:#fcfcfb; --ink:#0b0b0b; --ink2:#52514e; --muted:#898781;
  --grid:#e1e0d9; --axis:#c3c2b7; --ring:rgba(11,11,11,.10); --good:#006300;
  --s0:#b8b7b1; --s1:#2a78d6; --s2:#eb6834; --s3:#1baf7a; --s4:#eda100;
}}
@media (prefers-color-scheme: dark) {{
  :root {{
    color-scheme: dark;
    --page:#0d0d0d; --surface:#1a1a19; --ink:#fff; --ink2:#c3c2b7; --muted:#898781;
    --grid:#2c2c2a; --axis:#383835; --ring:rgba(255,255,255,.10); --good:#0ca30c;
    --s0:#5a5955; --s1:#3987e5; --s2:#d95926; --s3:#199e70; --s4:#c98500;
  }}
}}
* {{ box-sizing:border-box; }}
body {{ margin:0; background:var(--page); color:var(--ink);
  font:15px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif; }}
main {{ max-width:880px; margin:0 auto; padding:24px 16px 48px; }}
h1 {{ font-size:24px; margin:0 0 2px; }}
h2 {{ font-size:16px; margin:0 0 12px; display:flex; align-items:center; gap:8px; }}
.sub {{ color:var(--muted); font-size:13px; margin:0 0 20px; }}
.card {{ background:var(--surface); border:1px solid var(--ring); border-radius:12px; padding:18px; margin-bottom:16px; }}
.tiles {{ display:grid; grid-template-columns:repeat(auto-fit,minmax(160px,1fr)); gap:12px; margin-bottom:16px; }}
.tile {{ background:var(--surface); border:1px solid var(--ring); border-radius:12px; padding:14px 16px; }}
.tile .label {{ color:var(--ink2); font-size:13px; }}
.tile .value {{ font-size:28px; font-weight:600; }}
.tile .note {{ color:var(--muted); font-size:12px; }}
.pill {{ font-size:12px; font-weight:500; color:var(--ink2); border:1px solid var(--ring); border-radius:99px; padding:1px 8px; }}
.plan {{ display:grid; gap:12px; }}
.session {{ display:flex; gap:12px; }}
.session p {{ margin:2px 0 0; color:var(--ink2); font-size:14px; }}
.ok,.todo {{ flex:none; width:22px; height:22px; border-radius:50%; display:grid; place-items:center; font-size:13px; margin-top:1px; }}
.ok {{ background:var(--good); color:#fff; }}
.todo {{ border:1.5px solid var(--axis); color:transparent; }}
svg {{ width:100%; height:auto; display:block; }}
.grid {{ stroke:var(--grid); stroke-width:1; }}
.axis {{ stroke:var(--axis); stroke-width:1; }}
.tick {{ fill:var(--muted); font-size:11px; font-variant-numeric:tabular-nums; }}
.hit {{ fill:transparent; }}
.wk:hover .hit {{ fill:var(--grid); opacity:.5; }}
rect.s0,i.s0 {{ fill:var(--s0); background:var(--s0); }}
rect.s1,i.s1 {{ fill:var(--s1); background:var(--s1); }}
rect.s2,i.s2 {{ fill:var(--s2); background:var(--s2); }}
rect.s3,i.s3 {{ fill:var(--s3); background:var(--s3); }}
rect.s4,i.s4 {{ fill:var(--s4); background:var(--s4); }}
.legend {{ display:flex; flex-wrap:wrap; gap:14px; color:var(--ink2); font-size:13px; margin-bottom:8px; }}
.legend i,.dot {{ display:inline-block; width:10px; height:10px; border-radius:3px; margin-right:6px; }}
#tip {{ position:fixed; pointer-events:none; background:var(--surface); color:var(--ink);
  border:1px solid var(--ring); border-radius:8px; padding:8px 10px; font-size:13px;
  box-shadow:0 4px 16px rgba(0,0,0,.12); display:none; white-space:nowrap; }}
#tip b {{ display:block; margin-bottom:2px; }}
.scroll {{ overflow-x:auto; }}
table {{ width:100%; border-collapse:collapse; font-size:14px; }}
th {{ text-align:left; color:var(--ink2); font-weight:500; font-size:13px; padding:6px 8px; border-bottom:1px solid var(--axis); white-space:nowrap; }}
td {{ padding:7px 8px; border-bottom:1px solid var(--grid); white-space:nowrap; }}
td.wrap {{ white-space:normal; min-width:120px; }}
.num {{ font-variant-numeric:tabular-nums; }}
.desc {{ color:var(--ink2); font-size:13px; margin-left:16px; }}
@media (max-width:600px) {{ .tick {{ font-size:22px; }} main {{ padding-top:16px; }} }}
.coach {{ border-left:3px solid var(--s1); }}
.coach p {{ margin:0 0 8px; color:var(--ink2); }}
.coach p:last-child {{ margin:0; }}
</style></head>
<body><main>
<h1>Training Dashboard</h1>
<p class="sub">Updated {updated} · Max heart rate {max_hr} bpm</p>

<div class="tiles">
  <div class="tile"><div class="label">This week</div><div class="value">{this_week} km</div><div class="note">since Monday</div></div>
  <div class="tile"><div class="label">Weekly average</div><div class="value">{avg4} km</div><div class="note">previous 4 weeks</div></div>
  <div class="tile"><div class="label">Runs</div><div class="value">{runs28}</div><div class="note">last 28 days</div></div>
  <div class="tile"><div class="label">Easy share</div><div class="value">{easy_share}</div><div class="note">of running time, last 28 days · goal ~80%</div></div>
</div>

{plan}

<div class="card coach">
  <h2>Coach's note</h2>
  <p>The Norwegian method in one sentence: lots of truly easy running, plus controlled threshold work, never all-out.
  For you, easy means average heart rate <b>under {easy_ceiling} bpm</b>, even if that feels too slow at first.</p>
  <p>Orange bars are the grey zone. A little is fine, but if most weeks are orange, slow your easy runs down.</p>
</div>

<div class="card">
  <h2>Weekly distance (km)</h2>
  <div class="legend">{legend}</div>
  {chart}
</div>

<div class="card">
  <h2>Your heart rate zones</h2>
  <div class="scroll"><table><tr><th>Zone</th><th>Heart rate (bpm)</th></tr>{zone_rows}</table></div>
</div>

<div class="card">
  <h2>Recent runs</h2>
  <p class="sub" style="margin-bottom:8px">Zone is based on the run's average heart rate, so interval sessions with warm-up and cool-down can show one zone lower than the hard parts.</p>
  <div class="scroll"><table>
    <tr><th>Date</th><th>Run</th><th>km</th><th>Time</th><th>Pace /km</th><th>Avg HR</th><th>Zone</th></tr>
    {run_rows}
  </table></div>
</div>
</main>
<div id="tip"></div>
<script>
(function () {{
  const tip = document.getElementById('tip');
  const show = (g, x, y) => {{
    const [head, ...rest] = g.dataset.tip.split('|');
    tip.innerHTML = '<b>' + head + '</b>' + rest.join('<br>');
    tip.style.display = 'block';
    tip.style.left = Math.max(8, Math.min(x + 14, window.innerWidth - tip.offsetWidth - 8)) + 'px';
    tip.style.top = (y + 14) + 'px';
  }};
  document.querySelectorAll('.wk').forEach(g => {{
    g.addEventListener('mousemove', e => show(g, e.clientX, e.clientY));
    g.addEventListener('mouseleave', () => tip.style.display = 'none');
    g.addEventListener('touchstart', e => {{ const t = e.touches[0]; show(g, t.clientX, t.clientY - 60); }}, {{passive: true}});
  }});
  document.addEventListener('touchstart', e => {{ if (!e.target.closest('.wk')) tip.style.display = 'none'; }}, {{passive: true}});
}})();
</script>
</body></html>"""
