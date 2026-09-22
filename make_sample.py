"""
Creates sample_activities.json: fake but realistic Strava activities for testing.

    python make_sample.py
    MOCK_ACTIVITIES=sample_activities.json DASHBOARD_PASSWORD=test1234 python build_site.py

Nothing here is real training data - it only exists so the dashboard can be built
and checked without Strava secrets.
"""
import json
import random
from datetime import datetime, timedelta

random.seed(7)
DAYS_BACK = 140
TODAY = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)
NAMES_EASY = ["Rolig tur", "Easy run", "Morning run", "Kveldstur", "Evening jog"]
NAMES_LONG = ["Langtur", "Long run", "Sunday long run", "Søndagstur"]
NAMES_THR = ["Terskeløkt", "Threshold intervals", "Intervaller", "Threshold session"]


def activity(idx, start, kind):
    if kind == "threshold":
        minutes = random.randint(48, 62)
        pace = random.uniform(4.55, 5.15)          # min/km overall incl. warm-up
        hr = random.uniform(160, 172)
        name = random.choice(NAMES_THR)
    elif kind == "long":
        minutes = random.randint(62, 85)
        pace = random.uniform(5.9, 6.5)
        hr = random.uniform(139, 150)
        name = random.choice(NAMES_LONG)
    else:
        minutes = random.randint(38, 52)
        pace = random.uniform(5.8, 6.4)
        hr = random.uniform(136, 150)
        name = random.choice(NAMES_EASY)
    moving = int(minutes * 60)
    distance = round(moving / 60 / pace * 1000)
    return {
        "id": 10_000_000 + idx,
        "name": name,
        "type": "Run",
        "sport_type": "Run",
        "start_date_local": start.strftime("%Y-%m-%dT%H:%M:%S"),
        "distance": float(distance),
        "moving_time": moving,
        "elapsed_time": moving + random.randint(0, 240),
        "total_elevation_gain": round(random.uniform(10, 180), 1),
        "average_heartrate": round(hr, 1),
        "max_heartrate": round(hr + random.uniform(8, 30), 1),
        "average_speed": round(distance / moving, 3),
        "max_speed": round(distance / moving * random.uniform(1.2, 1.8), 3),
        "average_cadence": round(random.uniform(78, 86), 1),
        "kudos_count": random.randint(0, 6),
        "map": {"id": f"a{10_000_000 + idx}", "summary_polyline": ""},
    }


out, idx = [], 0
day = TODAY - timedelta(days=DAYS_BACK)
while day <= TODAY:
    kind = {1: "threshold", 3: "easy", 6: "long"}.get(day.weekday())
    if kind and random.random() > 0.12:            # the odd missed session
        hour = 17 if day.weekday() != 6 else 10
        start = day + timedelta(hours=hour, minutes=random.randint(0, 40))
        if start <= datetime.now():
            out.append(activity(idx, start, kind))
            idx += 1
    day += timedelta(days=1)

# a couple of non-runs, so the filtering gets exercised too
for n, (sport, mins) in enumerate([("Ride", 75), ("WeightTraining", 45), ("Walk", 30)]):
    start = TODAY - timedelta(days=4 + n * 9, hours=-18)
    out.append({"id": 20_000_000 + n, "name": sport, "type": sport, "sport_type": sport,
                "start_date_local": start.strftime("%Y-%m-%dT%H:%M:%S"),
                "distance": 20000.0 if sport == "Ride" else 2000.0,
                "moving_time": mins * 60, "elapsed_time": mins * 60,
                "total_elevation_gain": 50.0, "average_heartrate": 120.0})

out.sort(key=lambda a: a["start_date_local"], reverse=True)
with open("sample_activities.json", "w", encoding="utf-8") as f:
    json.dump(out, f, indent=1)
print(f"Wrote sample_activities.json with {len(out)} activities.")
