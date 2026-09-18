# Pykachu Go

Pykachu Go is a mobile-first Pokémon-themed programming puzzle hunt. Teams scan
QR codes, solve Python or C++ riddles, unlock the next physical location, and
are ranked by total score.

## What players do

1. Register with a team name and password.
2. Scan the starting QR code or enter its start key.
3. Solve the displayed coding riddle.
4. View the revealed next location and scan its QR code.
5. Continue until the final puzzle is complete.

The game runs as a static web app. Google Sheets, through Google Apps Script,
stores the event data and powers the admin dashboard.

## Main features

- Pokémon-style responsive CRT interface and installable PWA shell.
- Python and C++ variants for each puzzle.
- QR camera scanner with manual-entry fallback.
- Branching puzzle graph using `nextPuzzleId`.
- Hint timer and tab-switch blocking penalties.
- YouTube meme QR player with full-screen crop, loop, tap-to-unmute, and a
  safe return to the scanner when YouTube cannot load.
- Google Sheets audit logs and an admin leaderboard.

## Project layout

```text
index.html                     Player application
admin.html                     Admin dashboard
data/puzzle.json               Puzzle graph, answers, scores, hints and locations
data/teams.json                Team roster used by the player login
data/meme.json                 Meme QR IDs and YouTube clip settings
html/                          Dynamically included screen partials
css/                           Component, responsive, success, and overlay styles
js/                            Game logic, scanner, Sheets client and meme player
scripts/GoogleAppsScript.gs    Google Sheets backend
service-worker.js              PWA cache strategy
```

## Game flow

```text
Rules → Register → Scanner → Start key → Puzzle → Success / next location
```

Player screens:

| Screen | Purpose |
| --- | --- |
| `step0` | Rules and introduction |
| `step1` | Team login |
| `step2` | QR scanner and manual code entry |
| `startcode` | Starting-puzzle key entry |
| `step3` | Puzzle, answer form, hint and anti-switch monitoring |
| `step4` | Pokémon reveal, total result and next location(s) |
| `meme` | Full-screen YouTube meme overlay |

## Puzzle configuration

Each object in `data/puzzle.json` contains the puzzle ID, QR/deep-link ID,
language-specific question, answer, score, optional hint, location clue and
outgoing links.

```json
{
  "id": 1,
  "linkid": "XG01",
  "startCode": "START",
  "questionPython": "...",
  "questionCpp": "...",
  "answer": "-5",
  "nextPuzzleId": [2, 6],
  "locationClue": "CSE entrance - openspace",
  "level": 1,
  "points": 10,
  "hint": "BODMAS",
  "hintPenalty": 60,
  "pokemonId": 39
}
```

`nextPuzzleId` supports a branch: each linked puzzle is unlocked after a
correct solve. The app accepts query links such as `?linkid=XG01` and path
links such as `/XG01`.

## Scores and queues

The score shown in the player app and leaderboard is **Total Score**.

- A first-time solve awards the puzzle's configured `points` value.
- A repeated solve awards no additional points and deducts that puzzle's full
  value from the current total.
- Total score cannot go below zero.
- Wrong answers, hints, and tab-switch penalties are logged but do not directly
  deduct score.

Google Sheets persists two separate queues across `L1`, `L2`, and `L3`:

| Queue | Purpose |
| --- | --- |
| `Solved Puzzle IDs` | Decides whether a puzzle is a first solve or repeat for scoring. |
| `Unlocked Puzzle IDs` | Decides whether a QR/location is reachable; blocks jumps ahead. |

The client fetches and combines both queues across all level sheets when a team
returns. The latest Total Score snapshot is used by the leaderboard.

## Meme QR clips

Memes are configured in `data/meme.json`.

```json
{
  "memeid": "M01",
  "ytlink": "https://youtube.com/shorts/VIDEO_ID",
  "starttime": 0,
  "endtime": 0
}
```

Scan `M01`, open `?memid=M01`, or use `/M01` to play the clip. `endtime: 0`
plays to the end. The video loops, starts muted for autoplay compatibility, and
can be unmuted with a tap. If the YouTube API or an embedded video is blocked,
the player shows an error and returns to the scanner instead of leaving a blank
overlay.

## Google Sheets schema

The backend creates these tabs:

| Tab | Purpose |
| --- | --- |
| `Registration` | Team registration details |
| `L1`, `L2`, `L3` | Per-team, per-puzzle event records |

Level rows include timestamps, team identifiers, puzzle ID, wrong attempts,
hint usage, tab switches, points audit fields, status, Total Score, Unlocked
Puzzle IDs, and Solved Puzzle IDs.

Deploy the code in `scripts/GoogleAppsScript.gs` as a web app and set the
generated `/exec` URL in the runtime configuration below.

## Runtime configuration

The Google Apps Script settings are intentionally not committed in the app
source. For local development:

```powershell
Copy-Item .env.example .env
```

Then fill in `.env`:

```text
GOOGLE_SCRIPT_URL=https://script.google.com/macros/s/YOUR_DEPLOYMENT_ID/exec
GOOGLE_SCRIPT_TOKEN=YOUR_GOOGLE_SCRIPT_TOKEN
```

`npm run serve` generates the ignored `js/runtime-config.js` from `.env` and
loads it before both the player and admin app. The generated file is still
delivered to browsers, so it is configuration hygiene—not a security boundary.

For GitHub Pages, create these repository or `github-pages` environment
secrets. The deployment workflow generates `js/runtime-config.js` before it
uploads the site:

```text
GOOGLE_SCRIPT_URL
GOOGLE_SCRIPT_TOKEN
```

## Local development

```powershell
npm install
npm run build
npm run serve
```

Open the local URL printed by `serve`. Camera access generally requires either
`localhost` or HTTPS.

Run `npm run build` whenever Tailwind utility classes change.

## Deployment

1. Configure the Google Apps Script web app and deploy its latest version.
2. Add `GOOGLE_SCRIPT_URL` and `GOOGLE_SCRIPT_TOKEN` to GitHub Actions secrets.
3. Push to `main` or run the Pages workflow manually.
4. Bump `CACHE_NAME` in `service-worker.js` when making a release that must
   replace offline assets immediately.

## Important security note

This is a static client-side game. Browser-delivered configuration, team data,
and client requests can be inspected or changed by a determined user. For a
competitive or high-stakes event, validate puzzle answers, progression, scores,
and admin actions on a trusted server rather than accepting client-supplied
values in Apps Script.
