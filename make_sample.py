"""
Creates test data so the site can be built without Strava secrets:

    python make_sample.py
    MOCK_ACTIVITIES=sample_activities.json DASHBOARD_PASSWORD=test1234 python build_site.py

  sample_activities.json  fake activities in Strava's /athlete/activities format
  sample_detail.json      the matching per-run detail, in exactly the shape
                          strava_cache.py stores (it is built by the same code)

Each run is simulated second by second - speed, heart rate, altitude and a route -
so the run page (map, heart-rate curve, splits, laps, zones) can be checked properly.
Nothing here is real training data.
"""
import json
import math
import random
from datetime import datetime, timedelta

import strava_cache

random.seed(7)
DAYS_BACK = 140
TODAY = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)
HOME = (62.4722, 6.1495)          # a loop near Ålesund, so the map has something to draw
NAMES = {
    "easy": ["Rolig tur", "Easy run", "Morning run", "Kveldstur", "Evening jog"],
    "long": ["Langtur", "Long run", "Sunday long run", "Søndagstur"],
    "threshold": ["Terskeløkt", "Threshold intervals", "Intervaller", "Threshold session"],
}


def encode_polyline(points):
    """Google's encoded-polyline format - the same thing Strava's summary_polyline uses."""
    out, prev_lat, prev_lng = [], 0, 0
    for lat, lng in points:
        for value, prev in ((round(lat * 1e5), prev_lat), (round(lng * 1e5), prev_lng)):
            diff = value - prev
            diff = ~(diff << 1) if diff < 0 else diff << 1
            while diff >= 0x20:
                out.append(chr((0x20 | (diff & 0x1f)) + 63))
                diff >>= 5
            out.append(chr(diff + 63))
        prev_lat, prev_lng = round(lat * 1e5), round(lng * 1e5)
    return "".join(out)


def route(distance_m, seed):
    """A wandering loop that starts and ends at home, ~60 points."""
    rnd = random.Random(seed)
    n, radius = 60, distance_m / 1000 * 0.0045
    pts, wobble = [], [rnd.uniform(0.6, 1.4) for _ in range(6)]
    for i in range(n + 1):
        a = 2 * math.pi * i / n
        r = radius * sum(w * math.sin((k + 1) * a + k) for k, w in enumerate(wobble)) / 6
        r += radius * 0.9
        pts.append((HOME[0] + r * math.sin(a) * 0.55, HOME[1] + r * math.cos(a)))
    return pts


def simulate(kind, minutes, reps=None):
    """One run, second by second: (streams, laps) in Strava's own format."""
    seconds = int(minutes * 60)
    if kind == "threshold":
        count, rep_s, rest_s = reps
        warm = 15 * 60
        blocks = [("warm", warm, 3.05, 138)]
        for i in range(count):
            blocks.append(("rep", rep_s, 4.05, 172))
            if i < count - 1:
                blocks.append(("jog", rest_s, 2.5, 152))
        blocks.append(("cool", max(seconds - sum(b[1] for b in blocks), 300), 2.95, 134))
    elif kind == "long":
        blocks = [("run", seconds, 2.72, 145)]
    else:
        blocks = [("run", seconds, 2.82, 142)]

    time_s, dist, hr, speed, alt, cad = [], [], [], [], [], []
    laps, t, metres, beat, lap_start = [], 0, 0.0, 95.0, 0
    for name, length, target_speed, target_hr in blocks:
        for i in range(int(length)):
            drift = 1 + 0.02 * math.sin(t / 420)                 # hills and fatigue
            v = max(target_speed * drift + random.gauss(0, 0.06), 1.2)
            beat += (target_hr * drift - beat) * 0.02 + random.gauss(0, 0.5)
            metres += v
            time_s.append(t)
            dist.append(round(metres, 1))
            speed.append(round(v, 2))
            hr.append(round(beat))
            alt.append(round(18 + 22 * math.sin(t / 500) + 6 * math.sin(t / 97), 1))
            # Strava's cadence is one foot's steps per minute; quicker running, quicker feet
            cad.append(round(78 + (v - 2.6) * 6 + random.gauss(0, 1.2)))
            t += 1
        if kind == "threshold":                                   # one lap per block
            laps.append({"lap_index": len(laps) + 1, "distance": metres - dist[lap_start],
                         "moving_time": t - lap_start, "elapsed_time": t - lap_start,
                         "average_heartrate": sum(hr[lap_start:t]) / max(t - lap_start, 1),
                         "max_heartrate": max(hr[lap_start:t]),
                         "total_elevation_gain": round(random.uniform(2, 18), 1)})
            lap_start = t
    if kind != "threshold":                                       # auto-lap every km
        km, start = 1, 0
        for i, d in enumerate(dist):
            if d >= km * 1000:
                laps.append({"lap_index": km, "distance": 1000.0,
                             "moving_time": time_s[i] - time_s[start],
                             "elapsed_time": time_s[i] - time_s[start],
                             "average_heartrate": sum(hr[start:i]) / max(i - start, 1),
                             "max_heartrate": max(hr[start:i] or [0]),
                             "total_elevation_gain": round(random.uniform(2, 14), 1)})
                km, start = km + 1, i
    streams = {k: {"data": v} for k, v in
               (("time", time_s), ("distance", dist), ("heartrate", hr),
                ("velocity_smooth", speed), ("altitude", alt), ("cadence", cad))}
    return streams, laps


activities, details, idx = [], {}, 0
day = TODAY - timedelta(days=DAYS_BACK)
while day <= TODAY:
    kind = {1: "threshold", 3: "easy", 6: "long"}.get(day.weekday())
    if not kind or random.random() < 0.12:                        # the odd missed session
        day += timedelta(days=1)
        continue
    start = day + timedelta(hours=10 if day.weekday() == 6 else 17, minutes=random.randint(0, 40))
    if start > datetime.now():
        day += timedelta(days=1)
        continue
    minutes = {"threshold": random.randint(50, 58), "easy": random.randint(38, 52),
               "long": random.randint(62, 85)}[kind]
    reps = random.choice([(6, 180, 60), (5, 300, 60), (4, 420, 60), (3, 600, 90)])
    streams, laps = simulate(kind, minutes, reps)
    data = streams["distance"]["data"]
    moving, distance = len(data), data[-1]
    beats = streams["heartrate"]["data"]
    rid = 10_000_000 + idx
    activities.append({
        "id": rid, "name": random.choice(NAMES[kind]), "type": "Run", "sport_type": "Run",
        "start_date_local": start.strftime("%Y-%m-%dT%H:%M:%S"),
        "distance": round(distance, 1), "moving_time": moving,
        "elapsed_time": moving + random.randint(0, 240),
        "total_elevation_gain": round(random.uniform(30, 190), 1),
        "average_heartrate": round(sum(beats) / len(beats), 1), "max_heartrate": float(max(beats)),
        "average_speed": round(distance / moving, 3),
        "max_speed": round(max(streams["velocity_smooth"]["data"]), 3),
        "average_cadence": round(sum(streams["cadence"]["data"]) / moving, 1),
        "kudos_count": random.randint(0, 6),
        "map": {"id": f"a{rid}", "summary_polyline": encode_polyline(route(distance, rid))},
    })
    details[rid] = strava_cache._shape(streams, laps)
    idx += 1
    day += timedelta(days=1)

# a few non-runs, so the filtering gets exercised too
for n, (sport, mins) in enumerate([("Ride", 75), ("WeightTraining", 45), ("Walk", 30)]):
    start = TODAY - timedelta(days=4 + n * 9) + timedelta(hours=18)
    activities.append({"id": 20_000_000 + n, "name": sport, "type": sport, "sport_type": sport,
                       "start_date_local": start.strftime("%Y-%m-%dT%H:%M:%S"),
                       "distance": 20000.0 if sport == "Ride" else 2000.0,
                       "moving_time": mins * 60, "elapsed_time": mins * 60,
                       "total_elevation_gain": 50.0, "average_heartrate": 120.0})

activities.sort(key=lambda a: a["start_date_local"], reverse=True)
with open("sample_activities.json", "w", encoding="utf-8") as f:
    json.dump(activities, f, indent=1)
with open("sample_detail.json", "w", encoding="utf-8") as f:
    json.dump(details, f, separators=(",", ":"))
print(f"Wrote sample_activities.json ({len(activities)} activities) "
      f"and sample_detail.json ({len(details)} runs).")
