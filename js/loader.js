/* ==========================================================================
   Loader script - CSI x Auron presents Pykachu Go
   Progress follows the three real images, then hands off to the app.
   No dependencies: this runs on a standalone page with nothing else loaded.
   ========================================================================== */
(function () {
    'use strict';

    var MIN_VISIBLE_MS = 900;   // long enough for the emblem to register
    var MAX_WAIT_MS = 4000;     // never hold the player past this, ever
    var FADE_MS = 320;          // matches the .is-done transition in loader.css
    var SESSION_KEY = 'pykachu.loader.forwarded';

    var stage = document.getElementById('loaderStage');
    var fill = document.getElementById('progressFill');
    var bar = document.getElementById('progressBar');
    var label = document.getElementById('progressLabel');
    var images = ['markCsi', 'markAuron', 'mainLogo']
        .map(function (id) { return document.getElementById(id); })
        .filter(Boolean);

    // Where to go next. ?next= wins, so the loader can hand off anywhere;
    // otherwise the app root. Relative, so it works in a Pages subpath too.
    var params = new URLSearchParams(window.location.search);
    var next = params.get('next') || '../index.html';

    var started = Date.now();
    var forwarded = false;

    function store(key, value) {
        try {
            window.sessionStorage.setItem(key, value);
        } catch (e) { /* private mode: the guard is a nicety, not a requirement */ }
    }

    function readStore(key) {
        try {
            return window.sessionStorage.getItem(key);
        } catch (e) {
            return null;
        }
    }

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
        var reduced = window.matchMedia
            && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

        window.setTimeout(function () {
            window.location.replace(next);
        }, reduced ? 0 : FADE_MS);

        // Last-resort net: if replace() is blocked or the app fails to boot,
        // leave a tap target so the player is never stranded on the loader.
        window.setTimeout(function () {
            if (stage && !stage.querySelector('.loader-retry')) {
                var retry = document.createElement('p');
                retry.className = 'noscript loader-retry';
                retry.innerHTML = 'Taking longer than expected &mdash; '
                    + '<a href="' + next + '">continue</a>';
                stage.appendChild(retry);
            }
        }, MAX_WAIT_MS + 4000);
    }

    function forwardWhenReady() {
        var elapsed = Date.now() - started;
        window.setTimeout(go, Math.max(0, MIN_VISIBLE_MS - elapsed));
    }

    // Already handed off once in this tab: skip the wait entirely so going
    // back to the loader never costs another delay.
    if (readStore(SESSION_KEY) === next) {
        setProgress(100);
        go();
        return;
    }

    setProgress(0);

    var settled = 0;
    function onImage() {
        settled++;
        setProgress((settled / images.length) * 100);
        if (settled >= images.length) forwardWhenReady();
    }

    images.forEach(function (img) {
        if (!img) return;
        if (img.complete && img.naturalWidth > 0) {
            settled++;
        } else {
            // 'error' counts as settled too: a missing emblem must not trap
            // the player here, it just means the loader shows a gap.
            img.addEventListener('load', onImage, { once: true });
            img.addEventListener('error', onImage, { once: true });
        }
    });

    setProgress((settled / Math.max(1, images.length)) * 100);
    if (settled >= images.length && images.length) forwardWhenReady();

    // Hard cap. Nothing online, a stalled image, a blocked CDN font - the
    // loader always yields to the app.
    window.setTimeout(go, MAX_WAIT_MS);

    if (stage) stage.classList.add('is-ready');
})();
