# Project Rules

## Keep index.html and the html/ folder in sync

The game UI lives in `index.html` (inline flow steps + overlays). The `html/` folder
contains standalone fragment mirrors of the same screens.

**Rule:** Every change made to a screen/overlay in `index.html` MUST be mirrored
identically in its corresponding `html/*.html` file in the same commit. The two
files must never drift apart.

Mapping:

| index.html section            | html/ mirror file   |
| ----------------------------- | ------------------- |
| `#step0`                      | `html/step0.html`   |
| `#step1`                      | `html/step1.html`   |
| `#step2`                      | `html/step2.html`   |
| `#startcode`                  | `html/startcode.html` |
| `#step3`                      | `html/step3.html`   |
| `#step4`                      | `html/step4.html`   |
| `#penaltyOverlay`             | `html/penalty.html` |
| `#hintContainer`              | `html/hint.html`    |
| `#memePlayerContainer`        | `html/meme.html`    |

Aside: these `html/` mirrors are NOT loaded at runtime (the app uses only
`index.html`); they exist as offline/preview copies and must stay in sync anyway.

## Other rules

- After editing any cached asset (`index.html`, `css/*`, `js/*`, `html/*`), bump
  `CACHE_NAME` in `service-worker.js`.
- No code comments unless asked.