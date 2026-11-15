# Pykachu Go v3.4

A Pokédex-styled interactive Python & C++ coding puzzle hunt built with **React 19**, **TypeScript**, **Tailwind CSS v4**, and **Vite**, running at **JSON-level speed** with an optional **Google Sheets + Apps Script** telemetry backend copy (`apps-script/Code.gs`).

Players log in with their team credentials (`team` / `tid` + `securityKey`) from `public/data/teams.json`, scan QR signal codes around the venue, solve Python/C++ puzzles inside a retro CRT terminal, unlock Pokémon companions & gym badges, and report live scores to the Admin Command Node.

---

## Key Features

- **Ultra-Fast JSON-Level User Experience**:
  - `public/data/config.json` — languages, mission sectors, and level groups.
  - `public/data/puzzle.json` — branching puzzle graph, Python/C++ snippets, hints, Pokémon & badges.
  - `public/data/meme.json` — YouTube QR meme clips (`?memid=...`).
  - `public/data/teams.json` — indexed into an O(1) in-memory `Map` (`tid` & team name) for instant trainer login.
  - `public/data/admin.json` — organizer `{ name, password }` credentials for instant Admin Command Node authentication.
- **Google Apps Script Copy Included (`apps-script/Code.gs`)**:
  - Ready-to-deploy `.gs` backend with **zero hardcoded secrets, IDs, or sheet tab names** (reads strictly from `PropertiesService.getScriptProperties()`).
  - Supports `CacheService`, `LockService`, and differential telemetry log polling when `VITE_APPS_SCRIPT_URL` is configured, while working smoothly offline/locally via `localStorage` if left unset.
- **Authentic Pokédex Shell & CRT Terminal**: Responsive portrait-first hardware frame across mobile, tablet, and laptop viewports with Prof. Oak's chalkboard rules, Web Audio synthesized retro SFX, and Pokéball landscape-to-portrait rotation lock.
- **Terminal-Scoped Anti-Tab-Switch Protection**: Automatically locks only the Step 3 coding terminal on tab switch / focus loss, triggers Officer Jenny's 15-second cooldown penalty, and pauses active Brock hint timers.
- **Admin Command Node (`/admin`, `#admin`, or `?admin=1`)**:
  - Verified against `public/data/admin.json` (`name` + `password`).
  - Live monitoring (`REGISTRATION`, `LEVEL 1`, `LEVEL 2`, `LEVEL 3`, `LEADERBOARD`, `ROSTER LOG`), CSV telemetry export, and `CREATE & BULK` studio (create/edit/delete Teams, Memes, and Puzzles + `.xlsx` bulk import & `.json` export).

---

## Getting Started (Local Development)

### 1. Install Dependencies & Run
```bash
npm install
npm run dev
```
The app starts on `http://localhost:3000`.
- **Player Login Example**: Team `PRANAV` (or `T001`), Security Key `123`
- **Admin Command Node (`/admin`)**: Name `ADMIN` (or `PRANAV`), Password `123` *(configurable in `public/data/admin.json`)*

### 2. Optional: Connect Google Sheets Telemetry (`apps-script/Code.gs`)
1. Open your Google Sheet → **Extensions → Apps Script** and paste `apps-script/Code.gs`.
2. In **Project Settings → Script Properties**, add ALL required keys:
   - `SHEET_REG` (e.g. `Registration`)
   - `SHEET_L1` (e.g. `L1`), `SHEET_L2` (e.g. `L2`), `SHEET_L3` (e.g. `L3`)
   - `GAME_EPOCH` (`1`), `TEAM_RATE_LIMIT` (`90`), `TEAM_RATE_WINDOW_SECS` (`60`), `CACHE_TTL_SECS` (`21600`)
   - `ADMIN_PASSWORD` (must match your organizer password in `public/data/admin.json`)
   - `MAX_PUZZLE_POINTS` (e.g. `500` — server-side upper bound per solve)
   - `SPREADSHEET_ID` (required only if Apps Script is standalone; optional if opened from Extensions → Apps Script)
3. Run `initializeSpreadsheet` once, then **Deploy → Web app** (`Execute as: Me`, `Who has access: Anyone`).
4. Copy `.env.example` to `.env` and set `VITE_APPS_SCRIPT_URL="<your-web-app-/exec-url>"`.

### 3. Build & Verify
```bash
npm run lint   # TypeScript check (tsc --noEmit)
npm run build  # Production bundle in ./dist
```
