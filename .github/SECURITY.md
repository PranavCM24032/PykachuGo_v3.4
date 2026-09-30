# Security Policy

## Supported versions

Pykachu Go is deployed continuously to GitHub Pages from `main`. There are no
long-lived release branches — users always get the latest deployed build.

| Version | Supported |
|---------|-----------|
| `main` (deployed to Pages) | ✅ |
| Anything older / self-hosted copies | ❌ |

Fixes land on `main` and ship with the next Pages deployment.

## Reporting a vulnerability

**Do not open a public issue, pull request, or Discord/message for a security
problem.** Report it privately by email to the maintainer:

> **pranavpaunikar.ml24@sbjit.edu.in**

Please include:

1. What the issue is, in one or two sentences.
2. Steps to reproduce (URL, team/puzzle id, browser + device if relevant).
3. Impact: what an attacker or cheater gains.
4. Any logs, screenshots, or console output — with tokens and team data redacted.

You will get an acknowledgement within 72 hours and a status update at least
every week until it is resolved. Please give the maintainer reasonable time to
ship a fix before disclosing publicly.

## Scope — what counts as a vulnerability

In scope:

- A path that lets a player **skip puzzles, forge an unlock, forge a solve, or
  inflate a score** without the intended puzzle chain or penalties.
- Bypassing the anti-cheat controls in `js/security.js` (blackout triggers,
  print-screen / devtools blocking, logic-freeze heartbeat).
- Reading or writing **other teams'** rows through the Apps Script endpoints, or
  reaching the `Registration` / `L1` / `L2` / `L3` sheets without the token.
- Abusing the admin dashboard: viewing aggregated data with a guessed or leaked
  admin token, or triggering `RESET_ALL` (which wipes every sheet) unauthorised.
- XSS or HTML/JS injection through player-controlled input — team name, start
  key, manual signal id, answer text — into the player app or `admin.html`.
- Exfiltration of team rosters, security keys, or per-team telemetry.

Out of scope (known and accepted by design):

- **The player token being readable in the browser.** `GOOGLE_SCRIPT_TOKEN` ships
  to every client. It is an anti-abuse speed bump, not a secret. Treat it as
  public; the real fix is server-side validation of answers and progression.
- Client-side progress, score, and queue data in `localStorage` being editable.
  The server re-derives state from its own rows.
- The anti-cheat system being bypassable by a determined user with devtools. It
  is deterrence for a campus event, not a security boundary.
- Rate-limit tuning or Apps Script quota exhaustion.
- Missing security headers on GitHub Pages, which we do not control.

## Fixing the real boundary

The client is fully inspectable. Anything that matters competitively must be
enforced in `scripts/GoogleAppsScript.gs`: answer checking, unlock validation,
scoring, and admin authorisation. If a report shows the client deciding an
outcome on its own, that is a valid and high-priority finding.

## What a good report looks like

> The player app lets me POST `SOLVED` for any `puzzleId` with a `totalScore` of
> 9999 to the Apps Script endpoint; the sheet accepts it and the leaderboard
> shows it. Steps: open the Network tab, replay the request, change `puzzleId`
> and `totalScore`.