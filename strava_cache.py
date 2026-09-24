"""
Everything fetched from Strava, and the encrypted cache that keeps it.

Strava allows few API calls (100 reads per 15 minutes and 1,000 a day on a
personal app) and the site rebuilds every hour, so nothing is fetched twice:

  cache/activities.enc   the whole activity list, all the way back. A full
                         re-read once a week (it also notices deleted
                         activities); otherwise only the last five weeks are
                         asked for again, which is one call.
  cache/<id>.enc         the detail of one activity, fetched once.

Both are AES-encrypted with a key derived from STRAVA_CLIENT_SECRET, like
token.enc, because the repository is public. The workflow commits them.

What is stored per activity (heavily trimmed - the raw streams are far too big):
  t/d/hr/sp/alt  ~160 evenly spaced samples: seconds, metres, bpm, cm/s, metres
  cad            the same samples of cadence: steps per minute (both feet) on
                 foot, revolutions per minute on a bike
  hrhist         seconds spent at each bpm (60-220), so heart-rate zones can be
                 recalculated later if max_hr ever changes
  splits         one entry per kilometre: seconds, average bpm, elevation gain
  laps           the laps from the watch - one per interval in a threshold session
  be             Strava's best efforts in the run (400 m ... marathon), with PR rank
  gear, cal, dev, temp, desc   shoe, calories, device, temperature, description
  cadv / detv    1 once cadence / the activity detail has been asked for; things
                 cached before those existed are topped up with one call each

A new activity costs two calls (streams + activity). The history arrives a
batch per hourly build, newest first, and each build stops well before the
limit (see RESERVE) so the next one can always read the activity list.
"""
import base64
import hashlib
import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime
from pathlib import Path

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

ROOT = Path(__file__).resolve().parent
CACHE = ROOT / "cache"
LIST_FILE = CACHE / "activities.enc"
API = "https://www.strava.com/api/v3"
SAMPLES = 160           # points kept per stream
VERSION = 2             # bump to re-fetch everything with a new shape
LIST_VERSION = 1
HR_MIN, HR_MAX = 60, 220
KEYS = "time,distance,heartrate,velocity_smooth,altitude,cadence"
FOOT = {"Run", "TrailRun", "VirtualRun", "Walk", "Hike"}
RESERVE = 30            # calls left in any window when a build stops fetching
RECENT_DAYS = 140
FULL_LIST_EVERY = 7 * 86400
LIST_OVERLAP = 35 * 86400


# ---------- encrypted cache files ----------

def _key(secret):
    return hashlib.sha256(("run-cache:" + secret).encode()).digest()


def _path(activity_id):
    return CACHE / f"{activity_id}.enc"


def _read(path, secret):
    if not path.exists():
        return None
    try:
        raw = base64.b64decode(path.read_text().strip())
        return json.loads(AESGCM(_key(secret)).decrypt(raw[:12], raw[12:], None))
    except Exception:
        return None


def _write(path, secret, data):
    CACHE.mkdir(exist_ok=True)
    iv = os.urandom(12)
    blob = AESGCM(_key(secret)).encrypt(iv, json.dumps(data, separators=(",", ":")).encode(), None)
    path.write_text(base64.b64encode(iv + blob).decode())


def read_cached(activity_id, secret):
    data = _read(_path(activity_id), secret)
    return data if data and data.get("v") == VERSION else None


def write_cached(activity_id, secret, data):
    _write(_path(activity_id), secret, data)


# ---------- talking to Strava ----------

class RateLimit(Exception):
    """Raised when Strava says we have used up the calls for this window."""


class Denied(Exception):
    """Raised on 401/403 - the login is missing the activity:read permission."""


def _left(headers):
    """Calls left in the tightest window: 15 minutes or the day, overall or reads."""
    left = None
    for name in ("X-RateLimit", "X-ReadRateLimit"):
        try:                               # e.g. "100,1000" and "43,220"
            limit = [int(x) for x in headers.get(f"{name}-Limit", "").split(",")]
            usage = [int(x) for x in headers.get(f"{name}-Usage", "").split(",")]
            here = min(lim - use for lim, use in zip(limit, usage))
            left = here if left is None else min(left, here)
        except Exception:
            pass
    return left


def _get(url, token):
    """GET returning (json, calls left)."""
    req = urllib.request.Request(url)
    req.add_header("Authorization", f"Bearer {token}")
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            body = json.loads(r.read())
            headers = r.headers
    except urllib.error.HTTPError as e:
        if e.code == 429:
            raise RateLimit("Strava rate limit reached")
        if e.code in (401, 403):
            # A permission problem, not a fact about this activity - never cache it
            # as "no data", or every activity would be stored empty for good.
            raise Denied(f"Strava refused the request ({e.code})")
        if e.code == 404:                 # a manual entry has no streams at all
            return None, None
        raise
    return body, _left(headers)


# ---------- the activity list ----------

KEEP = ("id", "name", "sport_type", "type", "start_date", "start_date_local", "distance", "moving_time",
        "elapsed_time", "total_elevation_gain", "average_heartrate", "max_heartrate", "average_cadence",
        "average_speed", "max_speed", "has_heartrate", "manual", "trainer", "gear_id", "workout_type",
        "average_watts", "kilojoules")


def _trim(a):
    out = {k: a[k] for k in KEEP if a.get(k) is not None}
    poly = (a.get("map") or {}).get("summary_polyline")
    if poly:
        out["map"] = {"summary_polyline": poly}
    return out


def _epoch(a):
    try:
        return datetime.fromisoformat(a["start_date"].replace("Z", "+00:00")).timestamp()
    except Exception:
        return 0


def _pages(token, after=None):
    out, page, left = [], 1, None
    while True:
        url = f"{API}/athlete/activities?per_page=200&page={page}" + (f"&after={int(after)}" if after else "")
        batch, left = _get(url, token)
        if not batch:
            return out, left
        out += [_trim(a) for a in batch]
        page += 1


def activity_list(token, secret, now=None):
    """Every activity on the account, newest first. Falls back to the cached
    list when Strava cannot be reached or the limit is used up, so a busy day
    never breaks the site."""
    now = now or time.time()
    cached = _read(LIST_FILE, secret)
    if not (cached and cached.get("v") == LIST_VERSION):
        cached = None
    try:
        if cached and now - cached.get("full", 0) < FULL_LIST_EVERY and cached.get("items"):
            after = max(_epoch(a) for a in cached["items"]) - LIST_OVERLAP
            fresh, _ = _pages(token, after)
            # what Strava sends back replaces that stretch of the old list - so
            # edits show and activities deleted in it disappear
            keep = [a for a in cached["items"] if _epoch(a) <= after]
            items, full = keep + fresh, cached["full"]
            how = f"{len(fresh)} recent"
        else:
            items, _ = _pages(token)
            full, how = now, "full list"
    except (RateLimit, urllib.error.URLError, OSError, ValueError) as e:
        if cached:
            print(f"::notice::Could not refresh the activity list ({e}) - using the cached one.")
            return sorted(cached["items"], key=_epoch, reverse=True)
        raise
    seen, unique = set(), []
    for a in sorted(items, key=_epoch, reverse=True):
        if a["id"] not in seen:
            seen.add(a["id"])
            unique.append(a)
    _write(LIST_FILE, secret, {"v": LIST_VERSION, "full": full, "items": unique})
    print(f"Activity list: {len(unique)} activities ({how} from Strava).")
    return unique


# ---------- shaping the data ----------

def _resample(values, count=SAMPLES):
    """Evenly spaced picks, so a 1-hour run costs the same as a 20-minute one."""
    if not values:
        return []
    if len(values) <= count:
        return [None if v is None else round(v) for v in values]
    step = (len(values) - 1) / (count - 1)
    return [None if values[round(i * step)] is None else round(values[round(i * step)])
            for i in range(count)]


def _histogram(time_s, hr):
    """Seconds spent at each heart rate, from the full-resolution stream."""
    if not hr or not time_s:
        return None
    hist = [0] * (HR_MAX - HR_MIN + 1)
    for i in range(1, len(hr)):
        beat, dt = hr[i], time_s[i] - time_s[i - 1]
        if beat is None or not 0 < dt <= 30:        # skip pauses and gaps
            continue
        hist[min(max(int(beat), HR_MIN), HR_MAX) - HR_MIN] += dt
    return hist if sum(hist) else None


def _splits(time_s, dist, hr, alt):
    """One entry per finished kilometre: seconds, average bpm, metres climbed."""
    if not dist or not time_s:
        return []
    out, km, start_i = [], 1, 0
    for i in range(1, len(dist)):
        while dist[i] >= km * 1000:
            beats = [b for b in (hr[start_i:i + 1] if hr else []) if b]
            climb = 0.0
            if alt:
                climb = sum(max(alt[j] - alt[j - 1], 0) for j in range(start_i + 1, i + 1))
            out.append({"km": km, "s": round(time_s[i] - time_s[start_i]),
                        "hr": round(sum(beats) / len(beats)) if beats else None,
                        "up": round(climb)})
            km, start_i = km + 1, i
            if km > 300:
                return out
    return out


def _laps(raw):
    if not isinstance(raw, list):
        return []
    raw = [lap for lap in raw if isinstance(lap, dict)]
    return [{"i": lap.get("lap_index", n + 1),
             "m": round(lap.get("distance") or 0),
             "s": round(lap.get("moving_time") or 0),
             "hr": round(lap["average_heartrate"]) if lap.get("average_heartrate") else None,
             "mhr": round(lap["max_heartrate"]) if lap.get("max_heartrate") else None,
             "up": round(lap.get("total_elevation_gain") or 0)}
            for n, lap in enumerate(raw)]


def _extras(detail):
    """What the activity endpoint adds beyond the streams."""
    if not isinstance(detail, dict):
        return {}
    out = {"detv": 1}
    be = [{"n": e.get("name"), "s": e.get("elapsed_time"), "m": round(e.get("distance") or 0),
           "pr": e.get("pr_rank")} for e in detail.get("best_efforts") or [] if isinstance(e, dict)
          and e.get("name") and e.get("elapsed_time")]
    if be:
        out["be"] = be
    gear = detail.get("gear") or {}
    if gear.get("id"):
        out["gear"] = {"id": gear["id"], "name": str(gear.get("name") or "")[:80]}
    for key, src in (("cal", "calories"), ("temp", "average_temp")):
        if isinstance(detail.get(src), (int, float)):
            out[key] = round(detail[src])
    if detail.get("device_name"):
        out["dev"] = str(detail["device_name"])[:60]
    if detail.get("description"):
        out["desc"] = str(detail["description"])[:600]
    return out


def _shape(streams, detail=None, sport="Run"):
    """The cached form of one activity. `detail` is Strava's activity (it
    carries the laps); a plain list is taken as the laps alone."""
    s = streams or {}
    grab = lambda k: (s.get(k) or {}).get("data") or []
    time_s, dist, hr = grab("time"), grab("distance"), grab("heartrate")
    speed, alt, cad = grab("velocity_smooth"), grab("altitude"), grab("cadence")
    laps = detail if isinstance(detail, list) else (detail or {}).get("laps")
    # Strava counts running cadence for one foot; everyone else means both
    feet = 2 if sport in FOOT else 1
    return {
        "v": VERSION, "cadv": 1,
        "t": _resample(time_s), "d": _resample(dist), "hr": _resample(hr),
        "sp": _resample([v * 100 for v in speed]) if speed else [],
        "alt": _resample(alt),
        "cad": _resample([None if c is None else c * feet for c in cad]) if cad else [],
        "hrhist": _histogram(time_s, hr),
        "splits": _splits(time_s, dist, hr, alt),
        "laps": _laps(laps),
    } | _extras(detail)


# ---------- what build_site.py calls ----------

def _streams(aid, token):
    return _get(f"{API}/activities/{aid}/streams?keys={urllib.parse.quote(KEYS)}&key_by_type=true", token)


def _activity(aid, token):
    return _get(f"{API}/activities/{aid}?include_all_efforts=false", token)


def collect(activities, token, secret, budget=80, now=None):
    """
    Detail for every activity we can serve: from the cache first, then Strava
    for what is missing. Order: the last 140 days first (new ones, then top-ups),
    then the history, newest first. `budget` is API calls per build.
    """
    now = now or time.time()
    details, calls, fetched, topped = {}, 0, 0, 0
    new_recent, new_old, up_recent, up_old = [], [], [], []
    for a in activities:
        aid = a["id"]
        cached = read_cached(aid, secret)
        recent = now - _epoch(a) < RECENT_DAYS * 86400
        if cached:
            details[aid] = cached
            if not cached.get("detv") or not cached.get("cadv"):
                (up_recent if recent else up_old).append(a)
        elif not a.get("manual"):
            (new_recent if recent else new_old).append(a)

    def stop(left):
        return left is not None and left < RESERVE

    def fetch_new(a):
        nonlocal calls, fetched
        streams, left = _streams(a["id"], token)
        detail, left2 = _activity(a["id"], token)
        calls += 2
        shaped = _shape(streams, detail if detail is not None else [], a.get("sport_type") or a.get("type"))
        shaped["detv"] = 1                  # asked once; a 404 is not asked again
        write_cached(a["id"], secret, shaped)
        details[a["id"]] = shaped
        fetched += 1
        return min(x for x in (left, left2, 10 ** 6) if x is not None)

    def top_up(a):
        nonlocal calls, topped
        cached, left = details[a["id"]], None
        if not cached.get("cadv"):
            streams, left = _streams(a["id"], token)
            calls += 1
            fresh = _shape(streams, None, a.get("sport_type") or a.get("type"))
            cached["cad"] = fresh["cad"] if len(fresh["cad"]) == len(cached.get("t") or []) else []
            cached["cadv"] = 1
        if not cached.get("detv"):
            detail, left = _activity(a["id"], token)
            calls += 1
            cached |= _extras(detail) or {"detv": 1}
            cached["detv"] = 1
        write_cached(a["id"], secret, cached)
        topped += 1
        return left

    queue = [(fetch_new, a, 2) for a in new_recent] + \
            [(top_up, a, (not details[a["id"]].get("detv")) + (not details[a["id"]].get("cadv"))) for a in up_recent] + \
            [(fetch_new, a, 2) for a in new_old] + \
            [(top_up, a, (not details[a["id"]].get("detv")) + (not details[a["id"]].get("cadv"))) for a in up_old]
    for job, a, cost in queue:
        if not token or calls + cost > budget:
            break
        try:
            left = job(a)
        except RateLimit:
            print("::notice::Strava rate limit hit - the rest comes with the next builds.")
            break
        except Denied as e:
            print(f"::warning::{e}. Does the Strava login still have 'activity:read_all'? "
                  f"Detail is skipped this build.")
            break
        except Exception as e:                       # never let detail break the build
            print(f"::warning::Could not read detail for activity {a['id']}: {e}")
            continue
        if stop(left):
            print("::notice::Close to Strava's limit - pausing until a later build.")
            break
    waiting = sum(1 for a in activities if a["id"] not in details and not a.get("manual"))
    print(f"Activity detail: {len(details)} stored ({fetched} new, {topped} topped up, "
          f"{waiting} still to fetch, {calls} API calls).")
    return details
