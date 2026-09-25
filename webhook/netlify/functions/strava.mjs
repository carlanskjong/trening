/*
 * Strava's doorbell for the training app.
 *
 * Strava calls this the moment an activity is added, changed or deleted.
 * All it does is ask GitHub to run the "Update dashboard" workflow now, instead
 * of waiting for the next scheduled build. It never sees or stores any training
 * data - Strava's message is only "activity 123 was created".
 *
 * Settings (Netlify: Site configuration -> Environment variables):
 *   WEBHOOK_KEY    a long random text; part of the address Strava calls, and
 *                  the verify token Strava sends when the subscription is made.
 *                  The same value is the GitHub secret WEBHOOK_KEY.
 *   GH_TOKEN       a fine-grained GitHub token for this one repository with
 *                  only "Actions: Read and write" - it can start builds, nothing else.
 *   GITHUB_REPO    optional, default carlanskjong/trening
 *   STRAVA_ATHLETE_ID  optional: ignore events for anyone else
 */
const env = (name, fallback = '') =>
  (globalThis.Netlify?.env?.get(name) ?? process.env[name] ?? fallback).trim();

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

// Constant-time comparison, so the key cannot be guessed a character at a time.
function same(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length || !a.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export default async (req, context) => {
  const key = env('WEBHOOK_KEY');
  if (!key || !same(context.params?.key || '', key)) return new Response('Not found', { status: 404 });
  const url = new URL(req.url);

  // Strava checks the address once, when the subscription is created.
  if (req.method === 'GET') {
    if (url.searchParams.get('hub.mode') === 'subscribe' && same(url.searchParams.get('hub.verify_token') || '', key)) {
      return json({ 'hub.challenge': url.searchParams.get('hub.challenge') || '' });
    }
    return new Response('Forbidden', { status: 403 });
  }
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  let event;
  try { event = await req.json(); } catch { return new Response('Bad request', { status: 400 }); }
  const athlete = env('STRAVA_ATHLETE_ID');
  if (event?.object_type !== 'activity' || (athlete && String(event.owner_id) !== athlete)) {
    return json({ ok: true, ignored: true });           // Strava wants a 200 either way
  }

  // Start the build. Strava gives us 2 seconds to answer, so do not wait longer
  // than that; GitHub normally answers in well under one.
  const repo = env('GITHUB_REPO', 'carlanskjong/trening');
  const reason = `Strava: ${event.aspect_type} activity`;
  const timer = new AbortController();
  const stop = setTimeout(() => timer.abort(), 1500);
  try {
    const res = await fetch(`https://api.github.com/repos/${repo}/actions/workflows/update.yaml/dispatches`, {
      method: 'POST', signal: timer.signal,
      headers: {
        Authorization: `Bearer ${env('GH_TOKEN')}`, Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'trening-strava-doorbell'
      },
      body: JSON.stringify({ ref: 'main', inputs: { reason } })
    });
    if (!res.ok) console.error('GitHub said', res.status, await res.text());
  } catch (e) {
    console.error('Could not reach GitHub:', e.message);   // the scheduled build picks it up anyway
  } finally {
    clearTimeout(stop);
  }
  return json({ ok: true });
};

export const config = { path: '/strava/:key' };
