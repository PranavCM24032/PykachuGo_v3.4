# Pull request

> Pykachu Go is permission-gated proprietary work (`LICENSE.md`). PRs are
> reviewed for authorised collaborators only.

## What changed

<!-- One or two sentences. What is different after this PR? -->

## Why

<!-- The problem this solves, or the link to the issue. -->

## How it was verified

<!-- Manual testing only — there is no automated test suite. Be specific:
     which flow, which browser/device, what you clicked and what you saw. -->

- [ ] Clicked through the affected flow on a real device or device emulator
- [ ] Console is clean (no new errors)
- [ ] `npx eslint .` produces no new errors

## Invariants

- [ ] `index.html` and the mirrored screens (`#startcode`, `#penaltyOverlay`,
      `#hintContainer`, `#memePlayerContainer`) are still identical to their
      `html/*.html` copies
- [ ] No `html/step*.html` files were added
- [ ] `CACHE_NAME` in `service-worker.js` was bumped (required when touching
      `index.html`, `css/*`, `js/*`, `html/*`)
- [ ] The `ASSETS` array was updated if a cached file was added or removed
- [ ] `css/tailwind.css` was rebuilt (`npm run build`) if `css/` changed
- [ ] `data/puzzle.json`, `data/teams.json`, `data/meme.json` still parse
- [ ] `README.md` updated if behaviour, config keys, endpoints, or the layout changed
- [ ] No `.env`, `js/runtime-config.js`, tokens, team security keys, or player data committed

## Notes for the reviewer

<!-- Anything that needs a second pair of eyes, or that you deliberately left out. -->