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


def probe(callback, key):
    """Knock on the doorbell exactly the way Strava will, and say plainly what
    answered - Strava itself only reports "does not return 200"."""
    url = callback + "?" + urllib.parse.urlencode(
        {"hub.mode": "subscribe", "hub.challenge": "probe-123", "hub.verify_token": key})
    req = urllib.request.Request(url, headers={"User-Agent": "trening-webhook-check"})
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            status, text = r.status, r.read().decode(errors="replace")
    except urllib.error.HTTPError as e:
        status, text = e.code, e.read().decode(errors="replace")
    except Exception as e:
        print(f"::error::Could not reach the Netlify site at all ({e}). Check the address - it is shown at the top "
              f"of the project in Netlify, like https://something.netlify.app")
        return False
    short = " ".join(text.split())[:120]
    if status == 200 and "probe-123" in text:
        print("Checked the doorbell: it answers correctly.")
        return True
    if "WEBHOOK_KEY is missing" in text:
        why = ("the function runs, but Netlify has no WEBHOOK_KEY. Add it under Project configuration -> "
               "Environment variables, then Deploys -> Trigger deploy -> Deploy project.")
    elif "wrong key" in text:
        why = ("the function runs, but its WEBHOOK_KEY is not the same as the GitHub secret WEBHOOK_KEY. Paste the "
               "same key into both (no spaces), then Deploys -> Trigger deploy -> Deploy project in Netlify.")
    elif status == 403:
        why = "the key matches, but the check was refused - tell Claude what this says: " + short
    elif status == 404:
        why = ("Netlify's own 'Page not found': the function is not on this site. Check Base directory = webhook "
               "and that the latest deploy is Published, and that the address is right.")
    else:
        why = f"unexpected answer - tell Claude what this says: {short}"
    print(f"::error::The doorbell answered {status}: {why}")
    return False


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

    callback = f"{site}/strava/{urllib.parse.quote(key, safe='')}"
    if not probe(callback, key):
        sys.exit(1)
    status, body = call("POST", API, {**auth, "callback_url": callback, "verify_token": key})
    if status in (200, 201) and isinstance(body, dict) and body.get("id"):
        print(f"Connected: subscription {body['id']}. A new Strava activity now starts a build within seconds.")
    else:
        sys.exit(f"::error::Strava did not accept it ({status}): {body}. Is the Netlify site deployed, and is "
                 f"WEBHOOK_KEY exactly the same in Netlify and in GitHub?")


if __name__ == "__main__":
    main()
