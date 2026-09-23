"""
Per-run detail from Strava: heart-rate/pace streams and laps.

Strava allows only a limited number of API calls (100 per 15 minutes on a new app),
and the site rebuilds every hour, so detail is fetched **once per run** and then kept
in `cache/<activity id>.enc` - AES-encrypted with a key derived from
STRAVA_CLIENT_SECRET, exactly like token.enc, because the repository is public.
The workflow commits those files, so later builds cost no API calls at all.

What is stored per run (heavily trimmed - the raw streams are far too big):
  t/d/hr/sp/alt  ~160 evenly spaced samples: seconds, metres, bpm, cm/s, metres
  cad            the same samples of cadence, in steps per minute (both feet)
  cadv           1 once cadence has been asked for - runs cached before cadence was
                 added lack it and are topped up a few at a time (one call each)
  hrhist         seconds spent at each bpm (60-220), so heart-rate zones can be
                 recalculated later if max_hr ever changes
  splits         one entry per kilometre: seconds, average bpm, elevation gain
  laps           the laps from the watch - one per interval in a threshold session
"""
import base64
import hashlib
import json
import os
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

ROOT = Path(__file__).resolve().parent
CACHE = ROOT / "cache"
SAMPLES = 160           # points kept per stream
VERSION = 2             # bump to re-fetch everything with a new shape
HR_MIN, HR_MAX = 60, 220
KEYS = "time,distance,heartrate,velocity_smooth,altitude,cadence"


# ---------- encrypted cache files ----------

def _key(secret):
    return hashlib.sha256(("run-cache:" + secret).encode()).digest()


def _path(activity_id):
    return CACHE / f"{activity_id}.enc"


def read_cached(activity_id, secret):
    p = _path(activity_id)
    if not p.exists():
        return None
    try:
        raw = base64.b64decode(p.read_text().strip())
        data = json.loads(AESGCM(_key(secret)).decrypt(raw[:12], raw[12:], None))
        return data if data.get("v") == VERSION else None
    except Exception:
        return None


def write_cached(activity_id, secret, data):
    CACHE.mkdir(exist_ok=True)
    iv = os.urandom(12)
    blob = AESGCM(_key(secret)).encrypt(iv, json.dumps(data, separators=(",", ":")).encode(), None)
    _path(activity_id).write_text(base64.b64encode(iv + blob).decode())


# ---------- talking to Strava ----------

class RateLimit(Exception):
    """Raised when Strava says we have used up the calls for this window."""


class Denied(Exception):
    """Raised on 401/403 - the login is missing the activity:read permission."""


def _get(url, token):
    """GET returning (json, calls left in the 15-minute window)."""
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
            # A permission problem, not a fact about this run - never cache it as
            # "no data", or every run would be stored empty for good.
            raise Denied(f"Strava refused the request ({e.code})")
        if e.code == 404:                 # a manual entry has no streams at all
            return None, None
        raise
    left = None
    try:                                   # e.g. "100,1000" and "43,220"
        limit = [int(x) for x in headers.get("X-RateLimit-Limit", "").split(",")]
        usage = [int(x) for x in headers.get("X-RateLimit-Usage", "").split(",")]
        left = min(l - u for l, u in zip(limit, usage))
    except Exception:
        pass
    return body, left


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
            if km > 80:
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


def _shape(streams, laps):
    s = streams or {}
    grab = lambda k: (s.get(k) or {}).get("data") or []
    time_s, dist, hr = grab("time"), grab("distance"), grab("heartrate")
    speed, alt, cad = grab("velocity_smooth"), grab("altitude"), grab("cadence")
    return {
        "v": VERSION, "cadv": 1,
        "t": _resample(time_s), "d": _resample(dist), "hr": _resample(hr),
        "sp": _resample([v * 100 for v in speed]) if speed else [],
        "alt": _resample(alt),
        # Strava counts running cadence for one foot; everyone else means both
        "cad": _resample([None if c is None else c * 2 for c in cad]) if cad else [],
        "hrhist": _histogram(time_s, hr),
        "splits": _splits(time_s, dist, hr, alt),
        "laps": _laps(laps),
    }


# ---------- what build_site.py calls ----------

def _add_cadence(cached, streams):
    """Top up a run cached before cadence was stored, keeping everything else."""
    fresh = _shape(streams, None)
    cached["cad"] = fresh["cad"] if len(fresh["cad"]) == len(cached.get("t") or []) else []
    cached["cadv"] = 1
    return cached


def collect(runs, token, secret, budget=80):
    """
    Detail for every run we can serve: from the cache first, then Strava for what is
    missing, newest run first. `budget` is API calls per build: a new run costs two
    (streams and laps), topping up an old run with cadence costs one. Whatever does
    not fit is picked up by the next hourly build.
    """
    details, calls, fetched, topped = {}, 0, 0, 0
    upgrades = []
    for run in runs:
        rid = run["id"]
        cached = read_cached(rid, secret)
        if cached:
            details[rid] = cached
            if not cached.get("cadv"):
                upgrades.append(rid)
            continue
        if not token or calls + 2 > budget:
            continue
        try:
            streams, left = _get(
                f"https://www.strava.com/api/v3/activities/{rid}/streams"
                f"?keys={urllib.parse.quote(KEYS)}&key_by_type=true", token)
            laps, _ = _get(f"https://www.strava.com/api/v3/activities/{rid}/laps", token)
            calls += 2
        except RateLimit:
            print("::notice::Strava rate limit hit - the rest of the runs come next build.")
            return _report(runs, details, fetched, topped)
        except Denied as e:
            print(f"::warning::{e}. Does the Strava login still have 'activity:read'? "
                  f"Run detail is skipped this build.")
            return _report(runs, details, fetched, topped)
        except Exception as e:                       # never let detail break the build
            print(f"::warning::Could not read detail for activity {rid}: {e}")
            continue
        fetched += 1
        shaped = _shape(streams, laps)
        write_cached(rid, secret, shaped)
        details[rid] = shaped
        if left is not None and left < 15:
            print("::notice::Close to the Strava rate limit - pausing until the next build.")
            return _report(runs, details, fetched, topped)

    # then give older runs their cadence, one call each, newest first
    for rid in upgrades:
        if not token or calls + 1 > budget:
            break
        try:
            streams, left = _get(
                f"https://www.strava.com/api/v3/activities/{rid}/streams"
                f"?keys={urllib.parse.quote(KEYS)}&key_by_type=true", token)
            calls += 1
        except (RateLimit, Denied):
            break
        except Exception as e:
            print(f"::warning::Could not add cadence to activity {rid}: {e}")
            continue
        details[rid] = _add_cadence(details[rid], streams)
        write_cached(rid, secret, details[rid])
        topped += 1
        if left is not None and left < 15:
            break
    return _report(runs, details, fetched, topped)


def _report(runs, details, fetched, topped):
    waiting = len(runs) - len(details)
    extra = f", {topped} topped up with cadence" if topped else ""
    print(f"Run detail: {len(details)} available ({fetched} newly fetched{extra}, {waiting} waiting).")
    return details
