# Strava's doorbell

A tiny Netlify site with one function (`netlify/functions/strava.mjs`). Strava
calls it the moment an activity is added, changed or deleted, and it asks GitHub
to run **Update dashboard** at once - so a new run shows up in the app a couple
of minutes after it reaches Strava, instead of at the next scheduled build
(which GitHub runs only every few hours on a free account).

It never sees training data: Strava's message is only "activity 123 was
created". It holds one GitHub token that can start builds and nothing else.
No secret is stored in this repository.

## Setting it up (once)

**1. A token that can only start builds.** On github.com: your picture (top
right) → **Settings** → **Developer settings** → **Personal access tokens** →
**Fine-grained tokens** → **Generate new token**.
- Name: `Strava doorbell`. Expiration: the longest offered.
- Repository access: **Only select repositories** → `trening`.
- Permissions → Repository permissions → **Actions: Read and write**. Nothing else.
- **Generate token** and copy it.

**2. A key.** Make up a long random text - 30 or more letters and digits, no
spaces (a password generator is ideal). It goes into Netlify and GitHub, so keep
it at hand for a minute.

**3. Netlify.** On app.netlify.com: **Add new project** → **Import an existing
project** → **GitHub** → pick `trening`.
- Project name: for example `trening-strava`.
- **Base directory: `webhook`**. Leave the other fields as they are.
- Under **Environment variables** (or afterwards in Project configuration →
  Environment variables) add `WEBHOOK_KEY` = the key from step 2, and
  `GH_TOKEN` = the token from step 1.
- **Deploy**. If you added the variables after the first deploy, go to
  **Deploys** → **Trigger deploy** → **Deploy project** once more.
- Note the address, e.g. `https://trening-strava.netlify.app`.

**4. The same key in GitHub.** In the `trening` repository: **Settings** →
**Secrets and variables** → **Actions** → **New repository secret**. Name
`WEBHOOK_KEY`, value = the key from step 2.

**5. Connect Strava.** In the repository: **Actions** → **Strava webhook** →
**Run workflow** → action `register`, site = the Netlify address → **Run
workflow**. A green tick means it is connected.

To test: change the title of any activity on Strava. Within a few seconds a run
called "Strava: update activity" appears under **Actions**.

## Changing or removing it

Run **Strava webhook** again with `show` (what is connected) or `remove`
(disconnect). The scheduled builds carry on either way.

## Cost

Free. Netlify only rebuilds this site when this folder changes (the `ignore`
line in `netlify.toml`), and the function runs a handful of times a day.
