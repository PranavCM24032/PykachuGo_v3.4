/* ==========================================================================
   Loader - CSI x Auron presents Pykachu Go

   The splash markup is html/loader.html, a partial like the other screens in
   that folder. js/include.js fetches it into index.html's #screen via the
   data-include attribute and then fires `includes:ready`; this script waits for
   that, holds the boot gate shut so no step flashes first, shows the splash for
   ~1.5s, and removes it to reveal step0.

   Nothing here is on the critical path for gameplay: if the partial never
   arrives, the gate simply lifts and the app carries on.
   ========================================================================== */
(function () {
    'use strict';

    var SPLASH_MS = 1500;       // the splash you asked for, ~1.5s
    var SPLASH_MAX_MS = 4000;   // ...but never longer, even if art crawls
    var INJECT_WAIT_MS = 3000;  // how long to wait for html/loader.html
    var FADE_MS = 300;          // matches #appLoader.is-done below

    var started = Date.now();
    var finished = false;
    var booting = false;

    function reduced() {
        return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    }

    // Reveal the app underneath the splash. Removing the class is what makes the
    // steps visible again; css/loader.css also releases them on a 3s timer in
    // case this script never runs at all.
    function liftGate() {
        if (document.documentElement) {
            document.documentElement.classList.remove('booting');
        }
    }

    function splash() {
        return document.getElementById('appLoader');
    }

    function finish() {
        if (finished) return;
        finished = true;

        var el = splash();
        liftGate();

        if (!el) return;

        var fill = el.querySelector('.progress-fill');
        if (fill) fill.style.width = '100%';

        el.classList.add('is-done');
        var stage = el.querySelector('.loader-stage');
        if (stage) stage.classList.add('is-done');

        window.setTimeout(function () {
            if (el.parentNode) el.parentNode.removeChild(el);
        }, reduced() ? 0 : FADE_MS);
    }

    function run(el) {
        var stage = el.querySelector('.loader-stage');
        if (stage) stage.classList.add('is-ready');

        // The bar sweeps for exactly the visible duration, so the fill and the
        // fade-out agree instead of the bar stalling at 100% on its own.
        el.style.setProperty('--loader-ms', SPLASH_MS + 'ms');

        // Warm the artwork so the reveal never pops in half-drawn.
        var images = ['markCsi', 'markAuron', 'mainLogo']
            .map(function (id) { return document.getElementById(id); })
            .filter(Boolean);
        var settled = 0;
        images.forEach(function (img) {
            if (img.complete && img.naturalWidth > 0) {
                settled++;
            } else {
                var bump = function () { settled++; };
                img.addEventListener('load', bump, { once: true });
                img.addEventListener('error', bump, { once: true });
            }
        });

        liftGate();

        // Normally 1.5s from now. Two cases push it later, both bounded: the
        // document is still loading, or the emblem art hasn't arrived.
        var base = SPLASH_MS;
        var waitForLoad = document.readyState !== 'complete';
        var waitForArt = settled < images.length;
        var guard = window.setTimeout(finish, SPLASH_MAX_MS);

        function go() {
            if (finished) return;
            var wait = (!waitForArt || settled >= images.length)
                ? Math.max(0, base - (Date.now() - started))
                : SPLASH_MAX_MS - (Date.now() - started);
            window.clearTimeout(guard);
            window.setTimeout(finish, Math.max(0, wait));
        }

        if (!waitForLoad) {
            go();
        } else {
            window.addEventListener('load', go, { once: true });
            go();
        }
    }

    function boot() {
        // Not injected yet - include.js is still fetching html/loader.html, so
        // leave `booting` false and let the includes:ready event call back.
        if (booting || !splash()) return;
        booting = true;
        run(splash());
    }

    // Not { once: true }: if the fragment arrives late (slow first visit) the
    // gate has already lifted, and a splash that lands without this firing
    // would sit on screen forever with nothing left to remove it.
    document.addEventListener('includes:ready', boot);
    boot();

    // Last resort: no partial, or include.js missing entirely. Never gate the
    // app on a splash.
    window.setTimeout(function () {
        if (!booting) liftGate();
    }, INJECT_WAIT_MS);
})();
