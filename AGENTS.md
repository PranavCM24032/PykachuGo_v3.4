# Project Rules

## Keep index.html and the html/ folder in sync

The game UI lives entirely in `index.html` (inline flow steps + overlays). The
`html/` folder holds mirrors of only the four standalone overlay screens, kept as
separate files for offline/preview use and for future APK packaging.

**Rule:** Every change made to one of these four screens in `index.html` MUST be
mirrored identically in its `html/*.html` file in the same commit. The two files
must never drift apart.

Mapping (the ONLY mirrored screens):

| index.html section            | html/ mirror file   |
| ----------------------------- | ------------------- |
| `#startcode`                  | `html/startcode.html` |
| `#penaltyOverlay`             | `html/penalty.html` |
| `#hintContainer`              | `html/hint.html`    |
| `#memePlayerContainer`        | `html/meme.html`    |

The flow steps (`#step0`–`#step4`) are inline in `index.html` only and are NOT
mirrored. Do not recreate `html/step*.html`.

Aside: these `html/` mirrors are NOT loaded at runtime (the app uses only
`index.html`); they exist as offline/preview copies and must stay in sync anyway.

## Other rules

- After editing any cached asset (`index.html`, `css/*`, `js/*`, `html/*`), bump
  `CACHE_NAME` in `service-worker.js`.
- If you add or delete any file listed in the `ASSETS` array in
  `service-worker.js`, update that array in the same commit — a stale entry no
  longer breaks install (the SW caches entries individually), but it does waste
  a failed request per install.
- No code comments unless asked.