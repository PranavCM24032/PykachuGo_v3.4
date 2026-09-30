# Contributing to Pykachu Go

Thanks for your interest. Read this before opening anything — the short version
is below.

## 1. Permission comes first

Pykachu Go is proprietary work by **Pranav Mohan Paunikar**. It is published for
individual academic study and faculty review only. Any fork, clone, deployment,
or event run with this software needs **prior written permission** from the
copyright holder — see [`LICENSE`](../LICENSE) for the full process and the
required sign-offs.

Because of that:

- Contributions are accepted from the maintainer and explicitly authorised
  collaborators only. If you have not received written permission, please do not
  fork, clone, or submit a pull request — open an issue describing your intent
  instead.
- Do not file issues that contain puzzle answers, `securityKey` values, sheet
  exports, or screenshots with player data.

## 2. Getting set up

```powershell
npm install
Copy-Item .env.example .env    # fill in GOOGLE_SCRIPT_URL / TOKEN / SHEET_URL
npm run serve                  # generates js/runtime-config.js, then serves
```

- `js/runtime-config.js` is generated from `.env` and is git-ignored. Never
  commit it.
- Camera access needs `localhost` or HTTPS.
- There is no bundler for app JS — it is plain scripts loaded by `index.html`.

## 3. House rules that break builds if ignored

These are project invariants, not preferences:

| Rule | Why |
|------|-----|
| Keep `index.html` and the four `html/` mirrors identical (`#startcode`, `#penaltyOverlay`, `#hintContainer`, `#memePlayerContainer`) | The mirrors are offline/APK copies; drift makes them lie |
| Never create `html/step*.html` | Flow steps are inline in `index.html` only |
| Bump `CACHE_NAME` in `service-worker.js` when you touch `index.html`, `css/*`, `js/*`, or `html/*` | Without it, players keep the old cached shell |
| Update the `ASSETS` array if you add or remove a cached file | Avoids a failed request on every SW install |
| Keep `data/*.json` valid | It is the whole puzzle graph; a bad edit bricks the game |
| Never commit `.env`, `js/runtime-config.js`, or `node_modules/` | Secrets and build artefacts |

## 4. Making a change

1. Branch off `main`: `git checkout -b short-description`.
2. Keep the diff focused — one concern per PR.
3. Match the surrounding code style: 4-space indent in HTML, existing naming in
   `js/`, no new frameworks, no bundler step.
4. No code comments unless you were asked for them.
5. If you touch `css/`, rebuild the compiled Tailwind output:
   `npm run build` (commit `css/tailwind.css` alongside the source).
6. Update `README.md` if you changed behaviour, config keys, endpoints, or the
   project layout — it documents the flow, the Sheets schema, and the API surface.

### Checks before you push

```powershell
npm run build     # if css/ changed
npx eslint .      # no-undef / no-unused-vars warnings, errors on real breakage
npm run serve     # click through the flow you touched
```

There is no automated test suite. Manual verification of the changed flow is
required, and say in the PR exactly what you clicked.

## 5. Commit messages

One line, imperative mood, describing the effect — matching the existing history:

```text
Land the reveal ball on a plasma platform with impact thud
Fix step 4 reveal never opening; harden camera, boot and SW lifecycles
Use one consistent voice per browser for the catch line
```

## 6. Pull requests

- Fill in the PR template: what changed, why, how you verified it, and whether
  `CACHE_NAME` / the `html/` mirrors / `README.md` needed the matching update.
- Target `main`. Pushing to `main` deploys to GitHub Pages automatically, so
  review before merging.
- Small, reviewable diffs merge faster than large rewrites.

## 7. Reporting bugs and security issues

- Bugs: use the **Bug report** issue template.
- Vulnerabilities: do **not** open a public issue. Follow
  [`SECURITY.md`](SECURITY.md).

Participation in this project is also governed by the
[Code of Conduct](CODE_OF_CONDUCT.md).