"""
Connects Strava to the doorbell (webhook/netlify/functions/strava.mjs), shows
what is connected, or disconnects it. Run by the "Strava webhook" workflow:

    python webhook/subscribe.py register https://<your-site>.netlify.app
    python webhook/subscribe.py show
    python webhook/subscribe.py remove

Needs STRAVA_CLIENT_SECRET and WEBHOOK_KEY in the environment (GitHub secrets);
the client id comes from config.json. A Strava app has at most one subscription,
so "register" replaces any old one. While registering, Strava calls the doorbell
once to check it answers - so the Netlify site must be deployed first.
"""
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

API = "https://www.strava.com/api/v3/push_subscriptions"
ROOT = Path(__file__).resolve().parent.parent


def call(method, url, data=None):
    body = urllib.parse.urlencode(data).encode() if data else None
    req = urllib.request.Request(url, data=body, method=method)
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            raw = r.read()
            return r.status, (json.loads(raw) if raw else None)
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode(errors="replace")[:500]


def main():
    action = sys.argv[1] if len(sys.argv) > 1 else "show"
    site = (sys.argv[2] if len(sys.argv) > 2 else "").strip().rstrip("/")
    client_id = str(json.loads((ROOT / "config.json").read_text())["client_id"])
    secret, key = os.environ.get("STRAVA_CLIENT_SECRET", "").strip(), os.environ.get("WEBHOOK_KEY", "").strip()
    if not secret:
        sys.exit("::error::The STRAVA_CLIENT_SECRET secret is missing.")
    auth = {"client_id": client_id, "client_secret": secret}

    status, subs = call("GET", API + "?" + urllib.parse.urlencode(auth))
    existing = subs if status == 200 and isinstance(subs, list) else []
    if status != 200:
        print(f"::warning::Could not list subscriptions ({status}): {subs}")
    for s in existing:
        where = "this doorbell" if site and s.get("callback_url", "").startswith(site + "/") else "another address"
        print(f"Subscription {s.get('id')} since {s.get('created_at', '?')} -> {where}")
    if action == "show":
        print("Nothing is connected." if not existing else "")
        return

    if action == "register":                  # check first, so a typo never removes a working setup
        if len(key) < 16:
            sys.exit("::error::Add a WEBHOOK_KEY secret of at least 16 characters - the same value as in Netlify.")
        if not site.startswith("https://"):
            sys.exit("::error::Give your Netlify site address, starting with https:// (for example "
                     "https://trening-strava.netlify.app).")
    for s in existing:                        # one per app: clear the way
        st, _ = call("DELETE", f"{API}/{s['id']}?{urllib.parse.urlencode(auth)}")
        print(f"Removed subscription {s['id']} ({st}).")
    if action == "remove":
        print("Strava is disconnected from the doorbell. The scheduled builds carry on as before.")
        return

    status, body = call("POST", API, {**auth, "callback_url": f"{site}/strava/{key}", "verify_token": key})
    if status in (200, 201) and isinstance(body, dict) and body.get("id"):
        print(f"Connected: subscription {body['id']}. A new Strava activity now starts a build within seconds.")
    else:
        sys.exit(f"::error::Strava did not accept it ({status}): {body}. Is the Netlify site deployed, and is "
                 f"WEBHOOK_KEY exactly the same in Netlify and in GitHub?")


if __name__ == "__main__":
    main()
