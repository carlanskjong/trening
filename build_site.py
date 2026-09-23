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
SETTINGS_FILE = ROOT / "settings.enc"
PLAN_FILE = ROOT / "plan.enc"
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


def load_encrypted(path, password, what):
    """Read one of the browser-written files. Never let a bad one fail the build."""
    if not path.exists():
        return {}
    try:
        blob = json.loads(path.read_text(encoding="utf-8"))
        key = PBKDF2HMAC(algorithm=hashes.SHA256(), length=32,
                         salt=base64.b64decode(blob["salt"]),
                         iterations=int(blob["rounds"])).derive(password.encode())
        plain = AESGCM(key).decrypt(base64.b64decode(blob["iv"]),
                                    base64.b64decode(blob["data"]), None)
        out = json.loads(plain)
        return out if isinstance(out, dict) else {}
    except Exception as e:
        print(f"::warning::Could not read {path.name} ({e}). Building without {what}.")
        return {}


def load_settings(password):
    """His own training settings, saved from the Settings page, over config.json."""
    saved = load_encrypted(SETTINGS_FILE, password, "his saved settings")
    keep = {}
    if isinstance(saved.get("max_hr"), int) and 120 <= saved["max_hr"] <= 230:
        keep["max_hr"] = saved["max_hr"]
    start = saved.get("plan_start")
    if isinstance(start, str) and len(start) == 10:
        try:
            datetime.strptime(start, "%Y-%m-%d")
            keep["plan_start"] = start
        except ValueError:
            pass
    days = saved.get("plan_days")
    if isinstance(days, dict):
        clean = {k: v for k, v in days.items()
                 if k in ("threshold", "easy", "long") and isinstance(v, int) and 0 <= v <= 6}
        if clean:
            keep["plan_days"] = clean
    return keep


def load_notes(password):
    """
    Your own notes about runs, written in the browser and saved back to this repo by
    the GitHub API. The file is encrypted with the dashboard password (same scheme as
    the page itself), because the repo is public. A broken or missing file must never
    fail the build - worst case the dashboard opens with no notes.
    """
    return load_encrypted(NOTES_FILE, password, "notes")


PLAN_TYPES = ("easy", "long", "threshold", "other", "race")


def load_plan(password):
    """
    His edited training plan: every session he has moved, changed, added or
    removed, saved from the Plan page into plan.enc like notes are. Checked
    field by field - it is written by a browser - and anything malformed is
    dropped rather than failing the build. Missing means the standard plan.
    """
    saved = load_encrypted(PLAN_FILE, password, "his edited plan")
    sessions, is_day = [], lambda v: isinstance(v, str) and len(v) == 10 and v[4] == "-" and v[7] == "-"
    for s in saved.get("sessions") or []:
        if not (isinstance(s, dict) and is_day(s.get("date")) and s.get("type") in PLAN_TYPES
                and isinstance(s.get("id"), str) and len(s["id"]) <= 80):
            continue
        sessions.append({"id": s["id"], "date": s["date"], "type": s["type"],
                         "title": str(s.get("title") or "")[:120], "detail": str(s.get("detail") or "")[:2000]})
    if not sessions or not is_day(saved.get("until")):
        return None
    return {"sessions": sessions, "until": saved["until"], "updated": str(saved.get("updated") or "")[:40]}


SHELL = """<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<meta name="theme-color" content="#0b1117">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="Trening">
<link rel="manifest" href="manifest.webmanifest">
<link rel="icon" href="icon.png">
<link rel="apple-touch-icon" sizes="180x180" href="icon-180.png">
<title>Training Dashboard</title>
<script>
  try {
    var t = localStorage.getItem('pref-theme');
    if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
  } catch (e) {}
</script>
<style>
@font-face { font-family:"Barlow Semi Condensed"; font-weight:600; font-display:swap;
  src:url(vendor/fonts/barlow-semi-condensed-600.woff2) format("woff2"); }
:root { color-scheme: light; --page:#f2f4f6; --surface:#ffffff; --ink:#0e1a26; --muted:#5c6874; --ring:rgba(14,26,38,.14);
  --accent:#2f4fd0; --accent-ink:#fff; --bad:#c0283a; }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { color-scheme: dark; --page:#0b1117; --surface:#141c24;
  --ink:#e8edf2; --muted:#8894a0; --ring:rgba(232,237,242,.16); --accent:#8ea2ff; --accent-ink:#0b1220; --bad:#f0616f; } }
:root[data-theme="dark"] { color-scheme: dark; --page:#0b1117; --surface:#141c24; --ink:#e8edf2; --muted:#8894a0;
  --ring:rgba(232,237,242,.16); --accent:#8ea2ff; --accent-ink:#0b1220; --bad:#f0616f; }
* { box-sizing: border-box; }
body { margin:0; min-height:100vh; display:grid; place-items:center; background:var(--page); color:var(--ink);
  font:16px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif; padding:16px; }
form { width:100%; max-width:340px; background:var(--surface); border:1px solid var(--ring); border-radius:20px; padding:26px;
  box-shadow:0 1px 2px rgba(14,26,38,.05), 0 10px 30px rgba(14,26,38,.08); }
h1 { font:600 30px/1.05 "Barlow Semi Condensed",system-ui,sans-serif; margin:0 0 6px; display:flex; align-items:center; gap:10px; }
h1 i { width:10px; height:26px; border-radius:3px; background:linear-gradient(#0da197,#ed8725); }
p { margin:0 0 18px; color:var(--muted); font-size:14px; }
input[type=password] { width:100%; font:inherit; padding:11px 13px; border:1px solid var(--ring); border-radius:12px; background:var(--page); color:var(--ink); }
label { display:flex; gap:8px; align-items:center; font-size:14px; color:var(--muted); margin:12px 0 18px; }
button { width:100%; font:inherit; font-weight:600; padding:12px; border:0; border-radius:12px; background:var(--accent); color:var(--accent-ink); }
#err { color:var(--bad); font-size:14px; min-height:21px; margin-top:8px; }
</style></head>
<body>
<form id="f">
  <h1><i></i>Trening</h1>
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
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
document.getElementById('f').addEventListener('submit', async e => {
  e.preventDefault();
  const pw = document.getElementById('pw').value, btn = document.getElementById('go');
  btn.disabled = true; btn.textContent = 'Opening…'; document.getElementById('err').textContent = '';
  try { const html = await unlock(pw); if (document.getElementById('remember').checked) store.set(pw); pwUsed = pw; show(html); }
  catch(err) { document.getElementById('err').textContent = 'Wrong password, try again.'; btn.disabled = false; btn.textContent = 'Open'; }
});
</script>
</body></html>"""


SERVICE_WORKER = """/*
 * Makes the dashboard behave like an app: it opens instantly, works with no
 * signal, and picks up a new build as soon as one is deployed.
 *
 * Every build writes a new VERSION here, which is what tells the browser the
 * app has changed. Same-origin requests go to the network first (so you always
 * get the newest page when you have signal) and fall back to the cache.
 */
const VERSION = '__VERSION__';
const CACHE = 'trening-' + VERSION;
// Vendored files carry their version in the path, so they never change once
// fetched: they live in their own cache that survives new builds.
const VENDOR_CACHE = 'trening-vendor';
const VENDOR = __VENDOR__;
const SHELL = ['./', './index.html', './manifest.webmanifest',
               './icon.png', './icon-192.png', './icon-180.png', './icon-maskable.png'];

self.addEventListener('install', e => {
  e.waitUntil(Promise.all([
    caches.open(CACHE).then(c => Promise.allSettled(SHELL.map(u => c.add(u)))),
    caches.open(VENDOR_CACHE).then(c => Promise.allSettled(VENDOR.map(u =>
      c.match(u).then(hit => hit || c.add(u))))),
  ]).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  const wanted = new Set(VENDOR.map(u => new URL(u, self.registration.scope).href));
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== CACHE && k !== VENDOR_CACHE).map(k => caches.delete(k))))
    .then(() => caches.open(VENDOR_CACHE))
    .then(c => c.keys().then(reqs => Promise.all(reqs.filter(r => !wanted.has(r.url)).map(r => c.delete(r)))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;   // map tiles, GitHub: leave alone
  if (url.pathname.includes('/vendor/')) {       // pinned files: cache first
    e.respondWith(caches.open(VENDOR_CACHE).then(c => c.match(req).then(hit => hit ||
      fetch(req).then(res => { if (res.ok) c.put(req, res.clone()); return res; }))));
    return;
  }
  e.respondWith(
    fetch(req).then(res => {
      if (res && res.ok) {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
      }
      return res;
    }).catch(() => caches.match(req).then(hit => hit || caches.match('./index.html')))
  );
});
"""


def write_site(page_html, password, version):
    if SITE.exists():
        shutil.rmtree(SITE)
    SITE.mkdir()
    payload = json.dumps(encrypt_page(page_html, password))
    SITE.mkdir(exist_ok=True)
    (SITE / "index.html").write_text(SHELL.replace("__PAYLOAD__", payload), encoding="utf-8")
    (SITE / "manifest.webmanifest").write_text(json.dumps({
        "name": "Trening – Training Dashboard", "short_name": "Trening",
        "description": "Your runs, your plan and your progress.",
        "start_url": ".", "scope": ".", "display": "standalone", "orientation": "portrait",
        "background_color": "#0b1117", "theme_color": "#0b1117",
        "icons": [
            {"src": "icon-192.png", "sizes": "192x192", "type": "image/png"},
            {"src": "icon.png", "sizes": "512x512", "type": "image/png"},
            {"src": "icon-maskable.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable"},
        ]}), encoding="utf-8")
    for name in ("icon.png", "icon-192.png", "icon-180.png", "icon-maskable.png"):
        if (ROOT / name).exists():
            shutil.copy(ROOT / name, SITE / name)
    # the map library and the typeface: pinned, verified copies (see vendor/README.md)
    shutil.copytree(ROOT / "vendor", SITE / "vendor",
                    ignore=shutil.ignore_patterns("*.md", "*.sh"))   # licences ship with the code
    vendored = sorted("./" + str(f.relative_to(SITE)) for f in (SITE / "vendor").rglob("*")
                      if f.is_file() and f.suffix != ".txt")
    (SITE / "sw.js").write_text(SERVICE_WORKER.replace("__VERSION__", version)
                                .replace("__VENDOR__", json.dumps(vendored)), encoding="utf-8")


def main():
    config = json.loads((ROOT / "config.json").read_text(encoding="utf-8"))
    password = os.environ.get("DASHBOARD_PASSWORD", "")
    if len(password) < 6:
        fail("DASHBOARD_PASSWORD secret is missing or shorter than 6 characters.")
    config.update(load_settings(password))          # what he chose on the Settings page wins

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
    version = now.strftime("%Y%m%d-%H%M%S")
    config["version"] = version
    write_site(report.render(activities, config, details, load_notes(password), load_plan(password)),
               password, version)
    runs = sum(1 for a in activities if a.get("sport_type", a.get("type")) in report.RUN_TYPES)
    print(f"Built dashboard: {len(activities)} activities, {runs} runs in the last {DAYS_BACK} days.")


if __name__ == "__main__":
    main()
