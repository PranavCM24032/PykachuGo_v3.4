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
    var SPLASH_MAX_MS = 4000;   // ...but never longer, even if art or boot crawls
    var INJECT_WAIT_MS = 3000;  // how long to wait for html/loader.html
    var FADE_MS = 300;          // matches #appLoader.is-done below

    var started = 0;           // set when the splash is actually mounted, not at parse
    var finished = false;
    var booting = false;
    var appBooted = false;     // main.js has picked step0 vs step1
    var kick = null;           // run()'s re-check, so a late app:booted still lands

    function reduced() {
        return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    }

    // Reveal the app underneath the splash. Removing the class is what makes the
    // steps visible again; css/loader.css also releases them on a timer in case
    // this script never runs at all. Deliberately only called from finish():
    // lifting it early would expose the step the app hasn't chosen yet.
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

        // Time the splash from the moment it is on screen. Measuring from script
        // parse made a cold first visit (slow partial + slow art) collapse the
        // splash to almost nothing.
        started = Date.now();

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
                // go() is hoisted, so the last image to land can re-check.
                var bump = function () { settled++; go(); };
                img.addEventListener('load', bump, { once: true });
                img.addEventListener('error', bump, { once: true });
            }
        });

        // Hold until BOTH the minimum time has passed AND the app has picked its
        // opening screen. Without the second condition a returning trainer sees
        // step0 flash and get yanked to the login form a moment later, because
        // main.js only decides between them once the puzzle data has loaded.
        var base = SPLASH_MS;
        var waitForArt = settled < images.length;
        var waitForBoot = !appBooted;
        var guard = window.setTimeout(finish, SPLASH_MAX_MS);

        function ready() {
            return (!waitForArt || settled >= images.length)
                && (!waitForBoot || appBooted);
        }

        function go() {
            if (finished) return;
            if (!ready()) return;
            var wait = Math.max(0, base - (Date.now() - started));
            window.clearTimeout(guard);
            window.setTimeout(finish, wait);
        }

        // The remaining preconditions (art decoded, app booted) can each resolve
        // after this point, and every one of them re-checks.
        window.addEventListener('load', go, { once: true });
        kick = go;
        go();
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

    // Registered here, not inside run(): main.js can pick its opening screen
    // BEFORE html/loader.html finishes injecting (small data JSONs beat the
    // partial fetch on a warm connection). A listener born in run() would miss
    // that event and the splash would sit out the full SPLASH_MAX_MS guard.
    window.addEventListener('app:booted', function () {
        appBooted = true;
        if (kick) kick();
    });

    // Last resort: no partial, or include.js missing entirely. Never gate the
    // app on a splash.
    window.setTimeout(function () {
        if (!booting) liftGate();
    }, INJECT_WAIT_MS);
})();
