/* ==========================================================================
   Loader script - CSI x Auron presents Pykachu Go

   Two modes, picked by what is in the DOM:
     in-app       #appLoader exists  -> splash inside the Pokedex screen, shown
                                       before step0, then removed. No navigation.
     standalone   (loader.html)       -> progress bar tracks the real images,
                                       then hands off to the app.
   ========================================================================== */
(function () {
    'use strict';

    var SPLASH_MS = 1500;      // in-app: the splash you asked for, ~1.5s
    var SPLASH_MAX_MS = 4000;  // ...but never longer, even if images crawl
    var FADE_MS = 300;         // matches #appLoader.is-done in loader.css
    var SESSION_KEY = 'pykachu.loader.forwarded';

    var appLoader = document.getElementById('appLoader');
    var stage = (appLoader && appLoader.querySelector('.loader-stage'))
        || document.getElementById('loaderStage');
    var images = ['markCsi', 'markAuron', 'mainLogo']
        .map(function (id) { return document.getElementById(id); })
        .filter(Boolean);

    function reduced() {
        return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    }

    function store(key, value) {
        try {
            window.sessionStorage.setItem(key, value);
        } catch (e) { /* private mode */ }
    }

    function readStore(key) {
        try {
            return window.sessionStorage.getItem(key);
        } catch (e) {
            return null;
        }
    }

    /* ── In-app splash: before step0, inside the shell ────────────────────── */
    function runInApp() {
        var done = false;
        var settled = 0;
        var fill = appLoader.querySelector('.progress-fill');
        var started = Date.now();

        appLoader.style.setProperty('--loader-ms', SPLASH_MS + 'ms');
        if (stage) stage.classList.add('is-ready');

        // Warm the artwork so the reveal doesn't pop in half-drawn.
        images.forEach(function (img) {
            if (img.complete && img.naturalWidth > 0) {
                settled++;
            } else {
                var bump = function () { settled++; };
                img.addEventListener('load', bump, { once: true });
                img.addEventListener('error', bump, { once: true });
            }
        });

        function finish() {
            if (done) return;
            done = true;

            if (fill) fill.style.width = '100%';
            if (stage) stage.classList.add('is-done');
            appLoader.classList.add('is-done');

            window.setTimeout(function () {
                if (appLoader.parentNode) appLoader.parentNode.removeChild(appLoader);
            }, reduced() ? 0 : FADE_MS);
        }

        // Normally 1.5s from now. Two cases push it later, both bounded: the
        // page hasn't finished loading, or the emblem art hasn't arrived.
        var base = SPLASH_MS;
        var waitForLoad = document.readyState !== 'complete';
        var waitForArt = settled < images.length;

        if (!waitForLoad) {
            window.setTimeout(finish, base);
        } else {
            var guard = window.setTimeout(finish, SPLASH_MAX_MS);
            var finishWhenSettled = function () {
                if (done) return;
                var elapsed = Date.now() - started;
                if (!waitForArt || settled >= images.length) {
                    window.clearTimeout(guard);
                    window.setTimeout(finish, Math.max(0, base - elapsed));
                }
            };
            window.addEventListener('load', finishWhenSettled, { once: true });
            finishWhenSettled();
        }
    }

    /* ── Standalone page: progress, then hand off to the app ──────────────── */
    function runStandalone() {
        var fill = document.getElementById('progressFill');
        var bar = document.getElementById('progressBar');
        var label = document.getElementById('progressLabel');
        var params = new URLSearchParams(window.location.search);
        var next = params.get('next') || '../index.html';
        var started = Date.now();
        var forwarded = false;

        function setProgress(percent) {
            var value = Math.max(0, Math.min(100, Math.round(percent)));
            if (fill) fill.style.width = value + '%';
            if (label) label.textContent = value + '%';
            if (bar) bar.setAttribute('aria-valuenow', String(value));
            return value;
        }

        function go() {
            if (forwarded) return;
            forwarded = true;
            store(SESSION_KEY, next);
            if (stage) stage.classList.add('is-done');
            window.setTimeout(function () {
                window.location.replace(next);
            }, reduced() ? 0 : 300);
        }

        // Already handed off in this tab: skip the wait entirely.
        if (readStore(SESSION_KEY) === next) {
            setProgress(100);
            go();
            return;
        }

        setProgress(0);
        if (stage) stage.classList.add('is-ready');

        var settled = 0;
        function onImage() {
            settled++;
            setProgress((settled / Math.max(1, images.length)) * 100);
            if (settled >= images.length) {
                var elapsed = Date.now() - started;
                window.setTimeout(go, Math.max(0, 900 - elapsed));
            }
        }

        images.forEach(function (img) {
            if (img.complete && img.naturalWidth > 0) settled++;
            else {
                // 'error' counts too: a missing emblem must not trap anyone.
                img.addEventListener('load', onImage, { once: true });
                img.addEventListener('error', onImage, { once: true });
            }
        });

        setProgress((settled / Math.max(1, images.length)) * 100);
        if (images.length && settled >= images.length) {
            window.setTimeout(go, Math.max(0, 900 - (Date.now() - started)));
        }

        window.setTimeout(go, 4000); // hard cap

        window.setTimeout(function () {
            if (!stage || stage.querySelector('.loader-retry')) return;
            var retry = document.createElement('p');
            retry.className = 'noscript loader-retry';
            retry.innerHTML = 'Taking longer than expected &mdash; '
                + '<a href="' + next + '">continue</a>';
            stage.appendChild(retry);
        }, 8000);
    }

    if (appLoader) runInApp();
    else runStandalone();
})();
