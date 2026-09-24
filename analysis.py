"""
What the numbers mean: the analysis behind the coach, the plan check and the
Progress page. Pure functions on Strava summaries and the cached detail
(strava_cache.py), so they are easy to test with the sample data.

  detect_reps     the work intervals of a session, from the watch laps or the pace
  judge_session   what kind of session a run was, and a coach's verdict on it
  gap             grade-adjusted pace (how fast it would have been on the flat)
  pace_targets    threshold and easy pace windows, learned from his own runs
  fitness_series  fitness, fatigue and form (42- and 7-day load averages)
  route_groups    runs on the same route, so they can be compared over time
  predict         a race time from a recent best effort (Riegel)

Coaching claims stay honest: no lactate meter, so heart rate is the proxy, and
heart rate lags on short reps - the texts say so where it matters.
"""
import math
import re
from datetime import timedelta

RUN_TYPES = {"Run", "TrailRun", "VirtualRun"}
FOOT_TYPES = RUN_TYPES | {"Walk", "Hike"}

# % of max heart rate
EASY_TOP, THR_LO, THR_HI = 75, 82, 88


def bpm(max_hr, pct):
    return round(max_hr * pct / 100)


def sport(a):
    return a.get("sport_type") or a.get("type") or "Workout"


def is_run(a):
    return sport(a) in RUN_TYPES


def fmt_pace(sec_per_km):
    if not sec_per_km:
        return "-"
    return f"{int(sec_per_km // 60)}:{int(round(sec_per_km % 60)) % 60:02d}"


# ------------------------------------------------------------------ reps

def _auto_laps(laps):
    """Laps the watch made by itself every kilometre (or mile) - they say
    nothing about intervals."""
    full = [l for l in laps[:-1] if l.get("m")]
    if len(full) < 2:
        return False
    auto = sum(1 for l in full if 985 <= l["m"] <= 1015 or 1600 <= l["m"] <= 1620)
    return auto >= 0.7 * len(full)


def _reps_from_laps(laps):
    usable = [l for l in laps if l.get("m", 0) >= 60 and l.get("s", 0) >= 15]
    if len(usable) < 3:
        return []
    paces = sorted(l["s"] / l["m"] * 1000 for l in usable)
    # the widest jump between neighbouring paces splits work from rest
    best, cut = 0.0, None
    for a, b in zip(paces, paces[1:]):
        jump = (b - a) / a
        if jump > best:
            best, cut = jump, (a + b) / 2
    if best < 0.10:
        return []
    work = [l for l in usable if l["s"] / l["m"] * 1000 < cut]
    # a single fast lap in a steady run is not a session
    if len(work) < 2 and not any(l["s"] >= 8 * 60 for l in work):
        return []
    return [{"s": l["s"], "m": l["m"], "hr": l.get("hr"), "mhr": l.get("mhr"), "lap": l.get("i"), "src": "laps"}
            for l in work]


def _reps_from_stream(det):
    """Fallback with no useful laps: stretches clearly faster than the rest.
    The streams hold ~160 samples, so only reps of 2 minutes or more show."""
    t, d, sp, hr = det.get("t") or [], det.get("d") or [], det.get("sp") or [], det.get("hr") or []
    n = len(sp)
    if n < 30 or len(t) != n or len(d) != n:
        return []
    v = [x if x and x > 50 else None for x in sp]
    sm = [None] * n
    for i in range(n):
        w = [x for x in v[max(0, i - 1):i + 2] if x]
        sm[i] = sum(w) / len(w) if w else None
    vals = sorted(x for x in sm if x)
    if len(vals) < 20:
        return []
    lo, hi = vals[int(len(vals) * 0.25)], vals[int(len(vals) * 0.92)]
    if (hi - lo) / lo < 0.15:
        return []                                # steady run
    cut = lo + (hi - lo) * 0.55
    reps, start = [], None
    for i in range(n + 1):
        fast = i < n and sm[i] is not None and sm[i] >= cut
        if fast and start is None:
            start = i
        elif not fast and start is not None:
            a, b = start, i - 1
            step = t[1] - t[0]                      # one sample's worth of time
            secs = t[b] - t[a] + step
            if secs >= 110 and d[b] is not None and d[a] is not None:
                beats = [x for x in hr[a:b + 1] if x] if len(hr) == n else []
                reps.append({"s": round(secs), "m": round(d[b] - d[a] + (v[a] or 0) / 100 * step),
                             "hr": round(sum(beats) / len(beats)) if beats else None,
                             "mhr": max(beats) if beats else None, "lap": None, "src": "pace"})
            start = None
    return reps if len(reps) >= 2 or any(r["s"] >= 8 * 60 for r in reps) else []


def detect_reps(det):
    """The work intervals of a session: [{s, m, hr, mhr, lap, src}] in order."""
    det = det or {}
    laps = det.get("laps") or []
    if len(laps) >= 3 and not _auto_laps(laps):
        reps = _reps_from_laps(laps)
        if reps:
            return reps
    return _reps_from_stream(det)


def rep_stats(reps, max_hr):
    """What the reps add up to, and how they were run."""
    if not reps:
        return None
    secs, metres = sum(r["s"] for r in reps), sum(r["m"] for r in reps)
    with_hr = [r for r in reps if r.get("hr")]
    hr = round(sum(r["hr"] * r["s"] for r in with_hr) / sum(r["s"] for r in with_hr)) if with_hr else None
    # on short reps heart rate is still climbing when the rep ends: the last
    # third of the set is the honest reading
    tail = with_hr[-max(1, len(with_hr) // 3):]
    hr_tail = round(sum(r["hr"] for r in tail) / len(tail)) if tail else None
    paces = [r["s"] / r["m"] * 1000 for r in reps if r["m"]]
    fade = (paces[-1] / paces[0] - 1) * 100 if len(paces) >= 3 else None
    return {"n": len(reps), "s": secs, "m": metres, "avg_s": round(secs / len(reps)),
            "pace": secs / metres * 1000 if metres else None, "hr": hr, "hr_tail": hr_tail,
            "over": sum(1 for r in with_hr if r["hr"] > bpm(max_hr, THR_HI) - 1),
            "short": secs / len(reps) < 150, "fade": fade}


# ------------------------------------------------------------ session kind

THRESHOLD_WORDS = re.compile(r"terskel|threshold|interval|tempo|45/15|drag", re.I)


def run_kind(a, zone_seconds, reps):
    """'threshold', 'long', 'easy' or 'race' for a run. Judged by what was
    done - time at threshold heart rate, detected reps, or Strava's own
    workout/race flag - never by the average heart rate, which for an interval
    session includes the warm-up and every jog."""
    if a.get("workout_type") == 1:
        return "race"
    zs = zone_seconds or {}
    if zs.get("threshold", 0) + zs.get("hard", 0) >= 8 * 60:
        return "threshold"
    if reps and sum(r["s"] for r in reps) >= 6 * 60:
        return "threshold"
    if a.get("workout_type") == 3 or (not zs and THRESHOLD_WORDS.search(a.get("name") or "")):
        return "threshold"
    return "long" if (a.get("moving_time") or 0) >= 55 * 60 else "easy"


def coach_verdict(a, kind, stats, zone_seconds, max_hr):
    """One or two honest sentences about a run, judged for what it was."""
    hr = a.get("average_heartrate")
    easy_max, lo, hi = bpm(max_hr, EASY_TOP), bpm(max_hr, THR_LO), bpm(max_hr, THR_HI) - 1
    if kind == "threshold":
        if stats and stats.get("hr"):
            reading = stats["hr_tail"] if stats["short"] else stats["hr"]
            what = (f'{stats["n"]} reps, {fmt_pace(stats["pace"])} /km on average')
            if reading > hi:
                say = (f"{what}, heart rate {reading} - above threshold ({lo}–{hi}). Ease off 5–10 s/km next "
                       f"time: the reps should end with the feeling you could do a few more.")
            elif reading >= lo:
                say = (f"{what}, heart rate {reading} - inside threshold ({lo}–{hi}). Controlled, exactly the "
                       f"Bakken way.")
            elif stats["short"]:
                say = (f"{what}, heart rate {reading}. On reps this short heart rate lags and rarely reaches "
                       f"{lo} - judge them by breathing: about three words at a time.")
            else:
                say = (f"{what}, heart rate {reading} - a little under threshold ({lo}–{hi}). Fine for a "
                       f"low-threshold day; otherwise the pace can come up a touch.")
            if stats.get("fade") is not None and stats["fade"] > 5:
                say += " The last reps were slower than the first - start the next session a little easier."
            return say
        zs = zone_seconds or {}
        t, h = round(zs.get("threshold", 0) / 60), round(zs.get("hard", 0) / 60)
        if t or h:
            return (f"{t} min at threshold heart rate ({lo}–{hi})" + (f" and {h} min above it" if h else "") +
                    ". Press the lap button (or use a workout on the watch) and the app can check each rep.")
        return "Threshold session. Without laps or heart rate the reps cannot be checked."
    if kind == "race":
        return "A race - well done. Take the next two or three days truly easy."
    if not hr:
        return ("No heart rate on this one. Check that the chest strap is damp and sitting snug - "
                "without it the zones are guesswork.")
    if hr >= easy_max:
        return (f"{hr:.0f} bpm on an {'long' if kind == 'long' else 'easy'} run puts it in the grey zone - "
                f"harder than easy, easier than threshold. It tires you without the threshold payoff. "
                f"Slow down until you are under {easy_max}.")
    if hr > easy_max - 6:
        return (f"Easy, but only just: {hr:.0f} bpm against a ceiling of {easy_max}. "
                f"Next time aim a little lower - it should feel almost lazy.")
    return (f"Well judged. {hr:.0f} bpm is comfortably inside easy (under {easy_max}), "
            f"which is exactly where most of your running should sit.")


# ------------------------------------------------------ grade-adjusted pace

def _cost(g):
    """Energy cost of running on a slope (Minetti et al. 2002), J/kg/m."""
    g = max(-0.3, min(0.3, g))
    return 155.4 * g ** 5 - 30.4 * g ** 4 - 43.3 * g ** 3 + 46.3 * g ** 2 + 19.5 * g + 3.6


def flat_metres(det):
    """For each sample, the distance it would have been worth on the flat
    (cumulative, same length as det['d']), or None without altitude."""
    d, alt = det.get("d") or [], det.get("alt") or []
    if len(d) < 3 or len(alt) != len(d):
        return None
    sm = [sum(alt[max(0, i - 1):i + 2]) / len(alt[max(0, i - 1):i + 2]) for i in range(len(alt))]
    out, acc = [0.0], 0.0
    for i in range(1, len(d)):
        dd = (d[i] or 0) - (d[i - 1] or 0)
        if dd <= 0:
            out.append(acc)
            continue
        factor = max(0.8, min(2.5, _cost((sm[i] - sm[i - 1]) / dd) / 3.6))
        acc += dd * factor
        out.append(acc)
    return out


def gap(det):
    """Grade-adjusted pace for the whole run (s/km), or None."""
    flat, t = flat_metres(det or {}), (det or {}).get("t") or []
    if not flat or not t or flat[-1] < 500:
        return None
    return (t[-1] - t[0]) / flat[-1] * 1000


def split_gaps(det):
    """Grade-adjusted pace per kilometre split, lined up with det['splits']."""
    flat, t, d = flat_metres(det or {}), det.get("t") or [], det.get("d") or []
    splits = det.get("splits") or []
    if not flat or not splits or len(t) != len(d):
        return []
    out, j = [], 0
    for km in range(1, len(splits) + 1):
        start = j
        while j < len(d) - 1 and (d[j] or 0) < km * 1000:
            j += 1
        dt, df = t[j] - t[start], flat[j] - flat[start]
        out.append(round(dt / df * 1000) if df > 200 else None)
    return out


# ------------------------------------------------------------- pace targets

def _window(paces, step=5, width=10):
    paces = sorted(paces)
    lo, hi = paces[len(paces) // 4], paces[(len(paces) * 3) // 4]
    lo, hi = step * math.floor(lo / step), step * math.ceil(hi / step)
    if hi - lo < width:
        mid = (lo + hi) / 2
        lo, hi = step * math.floor((mid - width / 2) / step), step * math.ceil((mid + width / 2) / step)
    return [lo, hi]


def pace_targets(runs, today, max_hr):
    """Pace windows learned from his own recent running (s/km), or None.
    threshold: reps of 2 min+ run at threshold heart rate, last 6 weeks (else 12)
    easy:      easy and long runs that stayed under the easy ceiling, last 6 weeks"""
    lo, hi, easy_max = bpm(max_hr, THR_LO) - 2, bpm(max_hr, THR_HI), bpm(max_hr, EASY_TOP)
    out = {}
    for weeks in (6, 12):
        cut = today - timedelta(weeks=weeks)
        paces, n = [], 0
        for r in runs:
            if r["_date"].date() < cut or r["_kind"] != "threshold":
                continue
            for rep in r["_reps"] or []:
                if rep["s"] >= 120 and rep.get("hr") and lo <= rep["hr"] <= hi and rep["m"]:
                    paces.append(rep["s"] / rep["m"] * 1000)
            n += 1
        if len(paces) >= 4:
            out["threshold"] = {"lo": _window(paces)[0], "hi": _window(paces)[1], "reps": len(paces), "weeks": weeks}
            break
    cut = today - timedelta(weeks=6)
    easy = [r["moving_time"] / r["distance"] * 1000 for r in runs
            if r["_date"].date() >= cut and r["_kind"] in ("easy", "long") and r.get("average_heartrate")
            and r["average_heartrate"] < easy_max and r["distance"] >= 3000]
    if len(easy) >= 3:
        w = _window(easy, 5, 20)
        out["easy"] = {"lo": w[0], "hi": w[1], "runs": len(easy)}
    return out or None


# ----------------------------------------------------------------- fitness

def fitness_series(daily, first, last):
    """Fitness (42-day average load), fatigue (7-day) and form (fitness minus
    fatigue, as it stood the morning of each day) - the classic model behind
    Strava's Fitness & Freshness. `daily` = {date: effort}."""
    ctl = atl = 0.0
    out, day = [], first
    k42, k7 = 1 - math.exp(-1 / 42), 1 - math.exp(-1 / 7)
    while day <= last:
        form = ctl - atl
        e = daily.get(day, 0)
        ctl += (e - ctl) * k42
        atl += (e - atl) * k7
        out.append((day, round(ctl, 1), round(atl, 1), round(form, 1)))
        day += timedelta(days=1)
    return out


# ------------------------------------------------------------ same route

def _decode(poly):
    pts, i, lat, lng = [], 0, 0, 0
    while i < len(poly):
        for which in (0, 1):
            shift = result = 0
            while True:
                b = ord(poly[i]) - 63
                i += 1
                result |= (b & 0x1F) << shift
                shift += 5
                if b < 0x20:
                    break
            delta = ~(result >> 1) if result & 1 else result >> 1
            if which == 0:
                lat += delta
            else:
                lng += delta
        pts.append((lat / 1e5, lng / 1e5))
    return pts


decode = _decode


def _metres(a, b):
    x = (b[1] - a[1]) * 111320 * math.cos(math.radians((a[0] + b[0]) / 2))
    y = (b[0] - a[0]) * 110540
    return math.hypot(x, y)


def _resample(pts, n):
    if len(pts) < 2:
        return pts
    cum = [0.0]
    for a, b in zip(pts, pts[1:]):
        cum.append(cum[-1] + _metres(a, b))
    total, out, j = cum[-1] or 1, [], 0
    for k in range(n):
        want = total * k / (n - 1)
        while j < len(cum) - 2 and cum[j + 1] < want:
            j += 1
        seg = cum[j + 1] - cum[j] or 1
        f = (want - cum[j]) / seg
        out.append((pts[j][0] + (pts[j + 1][0] - pts[j][0]) * f, pts[j][1] + (pts[j + 1][1] - pts[j][1]) * f))
    return out


def route_points(poly, n=24):
    pts = _decode(poly) if poly else []
    return _resample(pts, n) if len(pts) >= 2 else None


def route_groups(acts):
    """{activity id: group number} for runs that share a route: similar
    distance (within 8%), starts within 250 m, and the two lines never more
    than ~90 m apart on average (either direction). Only groups of 2+."""
    items = []
    for a in acts:
        poly = (a.get("map") or {}).get("summary_polyline")
        if not is_run(a) or not poly or (a.get("distance") or 0) < 1000:
            continue
        pts = route_points(poly)
        if pts:
            items.append((a["distance"], a["id"], pts))
    items.sort()
    parent = {i: i for _, i, _ in items}

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    def near(p, q):
        return sum(min(_metres(a, b) for b in q) for a in p) / len(p)

    for i, (d1, id1, p1) in enumerate(items):
        for d2, id2, p2 in items[i + 1:]:
            if d2 > d1 * 1.08:
                break
            if min(_metres(p1[0], p2[0]), _metres(p1[0], p2[-1])) > 250:
                continue
            if near(p1, p2) < 90 and near(p2, p1) < 90:
                parent[find(id2)] = find(id1)
    groups = {}
    for _, i, _ in items:
        groups.setdefault(find(i), []).append(i)
    out, n = {}, 0
    for members in groups.values():
        if len(members) >= 2:
            n += 1
            for m in members:
                out[m] = n
    return out


# ----------------------------------------------------------------- races

RACE_DISTANCES = {"5k": 5000, "10k": 10000, "half": 21097.5, "marathon": 42195}
EFFORT_METRES = {"1K": 1000, "1 mile": 1609.34, "2 mile": 3218.69, "5K": 5000, "10K": 10000,
                 "15K": 15000, "10 mile": 16093.4, "20K": 20000, "Half-Marathon": 21097.5}


def predict(efforts, metres):
    """A race time from the best recent effort nearest the race distance
    (Riegel: t2 = t1 x (d2/d1)^1.06). efforts = [(metres, seconds, label, date, id)].
    Riegel tends to be optimistic for newer runners over longer races - the
    page says so."""
    usable = [e for e in efforts if e[0] >= 1000]
    if not usable:
        return None
    best = min(usable, key=lambda e: (abs(math.log(metres / e[0])), -e[0]))
    return {"s": round(best[1] * (metres / best[0]) ** 1.06), "from": best[2], "from_s": best[1],
            "date": best[3], "id": best[4]}
