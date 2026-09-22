"""
Builds the password-protected dashboard website.
Runs automatically on GitHub every hour (see .github/workflows/update.yml).

Needs these GitHub secrets:
  STRAVA_CLIENT_SECRET, STRAVA_REFRESH_TOKEN, DASHBOARD_PASSWORD
Settings you may want to change live in config.json.
"""
import base64
import hashlib
import json
import os
import shutil
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC

import report
import strava_cache

ROOT = Path(__file__).resolve().parent
SITE = ROOT / "site"
TOKEN_FILE = ROOT / "token.enc"
NOTES_FILE = ROOT / "notes.enc"
DAYS_BACK = 140
PBKDF2_ROUNDS = 250_000
b64 = lambda b: base64.b64encode(b).decode()


def fail(msg):
    print(f"::error::{msg}")
    sys.exit(1)


# ---------- Strava ----------

def http_json(url, data=None, token=None):
    req = urllib.request.Request(url, data=urllib.parse.urlencode(data).encode() if data else None)
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read())


def token_key(secret):
    return hashlib.sha256(("token-store:" + secret).encode()).digest()


def load_saved_refresh_token(secret):
    if not TOKEN_FILE.exists():
        return None
    try:
        raw = base64.b64decode(TOKEN_FILE.read_text().strip())
        return AESGCM(token_key(secret)).decrypt(raw[:12], raw[12:], None).decode()
    except Exception:
        return None


def save_refresh_token(secret, refresh_token):
    iv = os.urandom(12)
    TOKEN_FILE.write_text(b64(iv + AESGCM(token_key(secret)).encrypt(iv, refresh_token.encode(), None)))


def get_access_token(client_id, secret):
    """Strava may hand out a new refresh token; keep the newest one (encrypted) in token.enc."""
    candidates = [t for t in (load_saved_refresh_token(secret), os.environ.get("STRAVA_REFRESH_TOKEN", "").strip()) if t]
    if not candidates:
        fail("STRAVA_REFRESH_TOKEN secret is missing.")
    last_error = None
    for refresh in dict.fromkeys(candidates):
        try:
            tok = http_json("https://www.strava.com/oauth/token", {
                "client_id": client_id, "client_secret": secret,
                "grant_type": "refresh_token", "refresh_token": refresh})
        except urllib.error.HTTPError as e:
            last_error = f"{e.code} {e.read().decode()[:200]}"
            continue
        if tok["refresh_token"] != load_saved_refresh_token(secret):
            save_refresh_token(secret, tok["refresh_token"])
        return tok["access_token"]
    fail(f"Strava rejected the login ({last_error}). Check STRAVA_CLIENT_SECRET and STRAVA_REFRESH_TOKEN.")


def fetch_activities(access_token):
    after = int(time.time()) - DAYS_BACK * 86400
    activities, page = [], 1
    while True:
        batch = http_json(f"https://www.strava.com/api/v3/athlete/activities?after={after}&per_page=200&page={page}",
                          token=access_token)
        if not batch:
            return activities
        activities += batch
        page += 1


# ---------- Encryption (decrypted in the browser with the same settings) ----------

def encrypt_page(html, password):
    salt, iv = os.urandom(16), os.urandom(12)
    key = PBKDF2HMAC(algorithm=hashes.SHA256(), length=32, salt=salt, iterations=PBKDF2_ROUNDS).derive(password.encode())
    data = AESGCM(key).encrypt(iv, html.encode(), None)
    return {"salt": b64(salt), "iv": b64(iv), "data": b64(data), "rounds": PBKDF2_ROUNDS}


def load_notes(password):
    """
    Your own notes about runs, written in the browser and saved back to this repo by
    the GitHub API. The file is encrypted with the dashboard password (same scheme as
    the page itself), because the repo is public. A broken or missing file must never
    fail the build - worst case the dashboard opens with no notes.
    """
    if not NOTES_FILE.exists():
        return {}
    try:
        blob = json.loads(NOTES_FILE.read_text(encoding="utf-8"))
        key = PBKDF2HMAC(algorithm=hashes.SHA256(), length=32,
                         salt=base64.b64decode(blob["salt"]),
                         iterations=int(blob["rounds"])).derive(password.encode())
        plain = AESGCM(key).decrypt(base64.b64decode(blob["iv"]),
                                    base64.b64decode(blob["data"]), None)
        notes = json.loads(plain)
        return notes if isinstance(notes, dict) else {}
    except Exception as e:
        print(f"::warning::Could not read notes.enc ({e}). Building without notes.")
        return {}


SHELL = """<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<meta name="theme-color" content="#2a78d6">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="Trening">
<link rel="manifest" href="manifest.webmanifest">
<link rel="icon" href="icon.png">
<link rel="apple-touch-icon" href="icon.png">
<title>Training Dashboard</title>
<style>
:root { color-scheme: light; --page:#f9f9f7; --surface:#fcfcfb; --ink:#0b0b0b; --muted:#6b6a66; --ring:rgba(11,11,11,.14); --accent:#2a78d6; --bad:#d03b3b; }
@media (prefers-color-scheme: dark) { :root { color-scheme: dark; --page:#0d0d0d; --surface:#1a1a19; --ink:#fff; --muted:#a3a29b; --ring:rgba(255,255,255,.16); --accent:#3987e5; } }
* { box-sizing: border-box; }
body { margin:0; min-height:100vh; display:grid; place-items:center; background:var(--page); color:var(--ink);
  font:16px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif; padding:16px; }
form { width:100%; max-width:340px; background:var(--surface); border:1px solid var(--ring); border-radius:14px; padding:24px; }
h1 { font-size:20px; margin:0 0 4px; } p { margin:0 0 16px; color:var(--muted); font-size:14px; }
input[type=password] { width:100%; font:inherit; padding:10px 12px; border:1px solid var(--ring); border-radius:8px; background:var(--page); color:var(--ink); }
label { display:flex; gap:8px; align-items:center; font-size:14px; color:var(--muted); margin:12px 0 16px; }
button { width:100%; font:inherit; font-weight:600; padding:10px; border:0; border-radius:8px; background:var(--accent); color:#fff; }
#err { color:var(--bad); font-size:14px; min-height:21px; margin-top:8px; }
</style></head>
<body>
<form id="f">
  <h1>Training Dashboard</h1>
  <p>Enter your password to open.</p>
  <input type="password" id="pw" autocomplete="current-password" placeholder="Password" required>
  <label><input type="checkbox" id="remember" checked> Remember on this device</label>
  <button id="go">Open</button>
  <div id="err"></div>
</form>
<script>
const PAYLOAD = __PAYLOAD__;
const bytes = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
async function unlock(pw) {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(pw), 'PBKDF2', false, ['deriveKey']);
  const key = await crypto.subtle.deriveKey({name:'PBKDF2', salt:bytes(PAYLOAD.salt), iterations:PAYLOAD.rounds, hash:'SHA-256'},
    base, {name:'AES-GCM', length:256}, false, ['decrypt']);
  const plain = await crypto.subtle.decrypt({name:'AES-GCM', iv:bytes(PAYLOAD.iv)}, key, bytes(PAYLOAD.data));
  return new TextDecoder().decode(plain);
}
let pwUsed = '';
function show(html) {
  // the dashboard re-uses the password to read and write your notes file
  try { sessionStorage.setItem('dash-pw', pwUsed); } catch (e) {}
  document.open(); document.write(html); document.close();
}
const store = { get(){ try { return localStorage.getItem('dash-pw'); } catch(e) { return null; } },
  set(v){ try { localStorage.setItem('dash-pw', v); } catch(e) {} }, clear(){ try { localStorage.removeItem('dash-pw'); } catch(e) {} } };
(async () => { const saved = store.get();
  if (saved) { try { const html = await unlock(saved); pwUsed = saved; show(html); } catch(e) { store.clear(); } } })();
document.getElementById('f').addEventListener('submit', async e => {
  e.preventDefault();
  const pw = document.getElementById('pw').value, btn = document.getElementById('go');
  btn.disabled = true; btn.textContent = 'Opening…'; document.getElementById('err').textContent = '';
  try { const html = await unlock(pw); if (document.getElementById('remember').checked) store.set(pw); pwUsed = pw; show(html); }
  catch(err) { document.getElementById('err').textContent = 'Wrong password, try again.'; btn.disabled = false; btn.textContent = 'Open'; }
});
</script>
</body></html>"""


def write_site(page_html, password):
    if SITE.exists():
        shutil.rmtree(SITE)
    SITE.mkdir()
    payload = json.dumps(encrypt_page(page_html, password))
    (SITE / "index.html").write_text(SHELL.replace("__PAYLOAD__", payload), encoding="utf-8")
    (SITE / "manifest.webmanifest").write_text(json.dumps({
        "name": "Training Dashboard", "short_name": "Trening", "start_url": ".", "display": "standalone",
        "background_color": "#f9f9f7", "theme_color": "#2a78d6",
        "icons": [{"src": "icon.png", "sizes": "512x512", "type": "image/png"}]}), encoding="utf-8")
    if (ROOT / "icon.png").exists():
        shutil.copy(ROOT / "icon.png", SITE / "icon.png")


def main():
    config = json.loads((ROOT / "config.json").read_text(encoding="utf-8"))
    password = os.environ.get("DASHBOARD_PASSWORD", "")
    if len(password) < 6:
        fail("DASHBOARD_PASSWORD secret is missing or shorter than 6 characters.")

    mock = os.environ.get("MOCK_ACTIVITIES")
    if mock:
        activities = json.loads(Path(mock).read_text())
        detail_file = Path(os.environ.get("MOCK_DETAIL", "sample_detail.json"))
        details = {int(k): v for k, v in json.loads(detail_file.read_text()).items()} \
            if detail_file.exists() else {}
    else:
        secret = os.environ.get("STRAVA_CLIENT_SECRET", "").strip()
        if not secret:
            fail("STRAVA_CLIENT_SECRET secret is missing.")
        access_token = get_access_token(str(config["client_id"]), secret)
        activities = fetch_activities(access_token)
        runs = [a for a in activities if a.get("sport_type", a.get("type")) in report.RUN_TYPES]
        details = strava_cache.collect(runs, access_token, secret)

    tz = ZoneInfo(config.get("timezone", "Europe/Oslo"))
    now = datetime.now(tz)
    config["updated"], config["today"] = now.strftime("%d.%m.%Y %H:%M"), now.date().isoformat()
    config["repo"] = os.environ.get("GITHUB_REPOSITORY") or config.get("repo", "")
    write_site(report.render(activities, config, details, load_notes(password)), password)
    runs = sum(1 for a in activities if a.get("sport_type", a.get("type")) in report.RUN_TYPES)
    print(f"Built dashboard: {len(activities)} activities, {runs} runs in the last {DAYS_BACK} days.")


if __name__ == "__main__":
    main()
