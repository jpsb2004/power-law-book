# Deploying

Three commands to go from this folder to a public, self-refreshing page.

## 1. Create the repo and push

Everything is committed locally already. Create an **empty** repo on GitHub
(no README, no .gitignore — this repo has both), then:

```bash
git remote add origin https://github.com/jpsb2004/power-law-book.git
git push -u origin main
```

## 2. Turn on Pages

In the new repo: **Settings → Pages → Build and deployment → Source:
`GitHub Actions`.**

Not "Deploy from a branch" — the workflow publishes the page as a build
artifact, so the branch option will not find it.

## 3. Run it once by hand

**Actions → Daily refresh → Run workflow.**

The first run proves the whole chain before the schedule ever fires. When it
finishes, the page is live at:

```
https://jpsb2004.github.io/power-law-book/
```

That URL is the one to put on a CV — it is public, needs no login, and updates
itself.

---

## What runs, and when

`.github/workflows/daily_refresh.yml` fires **weekdays at 22:00 UTC**, about two
hours after the US close, by which point every market in the book has settled.
GitHub cron is UTC and has no DST, so this drifts by an hour relative to São
Paulo across the year — harmless, since it snapshots a close rather than an
intraday moment.

Each run:

1. `node scripts/refresh.mjs` — fetch 18 positions + 5 FX pairs, validate,
   rebuild the page, smoke-test it in a DOM
2. commit the refreshed `data/snapshot.json` and `data/history.json` back to the
   repo, so the next run has a baseline to validate against
3. upload `out/` and deploy it to Pages

The exit code is the contract:

| Exit | Meaning | Build | Deploys? |
|---|---|---|---|
| 0 | validated and rebuilt | green | yes |
| 2 | **rejected** by validation, nothing changed | green | no |
| 1 | crashed | red | no |

A rejected refresh is a **successful defence**, not a failure — the guard
caught bad data and left the live page alone, so the build stays green and the
deploy is skipped. Only a crash goes red. Every run writes the last 25 lines of
pipeline output to the Actions job summary, so a rejection explains itself
without digging through logs.

## Things that will bite you eventually

- **Scheduled workflows are disabled after 60 days of repository inactivity.**
  GitHub emails first. A single manual run or commit re-arms it.
- **Runs can start late** when GitHub's scheduler is busy. Expected; the job
  snapshots a daily close, so a 20-minute delay changes nothing.
- **The data commits accumulate.** `snapshot.json` is ~370 KB and is committed
  on every successful weekday run — roughly 60 MB a year before git's
  compression. Fine for years; if it ever matters, drop `usdPoints` from the
  committed copy and keep the full series only in the build.
- **The free quote endpoint is unofficial.** It rate-limits and can change shape
  without notice. That is why the fetch layer retries and the validator refuses
  to publish a half-empty book.

## The live Next.js app (optional)

The app in `app/` fetches quotes per request and is not needed for the page. To
put it online too:

```bash
npx vercel
```

It needs no environment variables — the quote endpoint requires no API key.

## Relationship to the Claude scheduled task

There is also a local task (`~/.claude/scheduled-tasks/refresh-power-law-book/`)
that keeps the private Claude artifact in step. **It does not fetch market
data** — it pulls what CI already committed, rebuilds the page from it, and
republishes:

```
22:00 UTC  GitHub Action   fetch → validate → commit data → deploy Pages
22:22 UTC  Claude task     git pull → npm run page → republish artifact
```

The ordering matters, and so does the division of labour. Both processes used to
run `npm run refresh`, which writes the tracked files `data/snapshot.json` and
`data/history.json`. With CI committing those same files, the local task would
have hit a merge conflict on its next pull. Only CI fetches now; the local task
is read-only with respect to the repository and writes only the gitignored
`out/`.

| | Claude task | GitHub Action |
|---|---|---|
| Target | private artifact URL | public Pages URL |
| Fetches market data | no | yes |
| Runs when | the Claude app is open | always |
| Good for | a private preview | the link on your CV |

The Pages URL is the one worth sharing. The local task is optional — delete it
from the Scheduled sidebar if you would rather have a single source of truth.
