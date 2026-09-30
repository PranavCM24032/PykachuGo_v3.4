const CACHE_NAME = 'pykachu-go-v1.8.4';
const ASSETS = [
    'admin.html',
    'index.html',
    '404.html',
    'css/base.css',
    'css/shell.css',
    'css/buttons.css',
    'css/components.css',
    'css/terminal.css',
    'css/overlays.css',
    'css/animations.css',
    'css/success.css',
    'css/responsive.css',
    'css/security.css',
    'css/meme.css',
    'css/tailwind.css',
    'js/config.js',
    'js/runtime-config.js',
    'js/state.js',
    'js/audio.js',
    'js/data-loader.js',
    'js/google-sheets.js',
    'js/ui.js',
    'js/screens.js',
    'js/scanner.js',
    'js/meme.js',
    'js/penalty.js',
    'js/hint.js',
    'js/game.js',
    'js/main.js',
    'js/security.js',
    'js/include.js',
    'js/rate-limiter.js',
    'js/notepad.js',
    'js/custom-select.js',
    'html/startcode.html',
    'html/penalty.html',
    'html/hint.html',
    'html/meme.html',
    'html/loader.html',
    'css/loader.css',
    'js/loader.js',
    'manifest.json',
    'data/puzzle.json',
    'data/teams.json',
    'data/meme.json',
    'service-worker.js',
    'assets/img/ash.png',
    'assets/img/ash-2.png',
    'assets/img/ash-3.png',
    'assets/img/brock.png',
    'assets/img/jenny.png',
    'assets/img/joy.png',
    'assets/img/oak.png',
    'assets/img/officer-jenny.png',
    'assets/img/poketropy.png',
    'assets/img/python.png',
    'assets/img/C++.png',
    'assets/img/grass.png',
    'assets/img/fire.png',
    'assets/img/water.png',
    'assets/img/ground.png',
    'assets/img/ghost.png',
    'assets/img/fairy.png',
    'assets/img/pikachu.png',
    'assets/img/pykachu.png',
    'assets/img/go.png',
    'assets/img/favicon.svg',
    // Loader emblem art
    'assets/img/logo1.png',
    'assets/img/csi.jpg',
    'assets/img/auron.png'
];

self.addEventListener('install', (event) => {
    // Cache entries individually rather than via addAll(): addAll() is
    // all-or-nothing, so a single missing/renamed file rejects the whole
    // promise and no offline support installs at all. A partial cache is far
    // better than none. The .catch() matters too — caches.open() itself can
    // reject (private-mode quota, corrupt origin storage), and an unhandled
    // rejection inside waitUntil discards the new worker entirely, leaving the
    // previous CACHE_NAME serving stale assets indefinitely. skipWaiting() goes
    // INSIDE waitUntil so the worker never activates with an empty cache.
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) =>
                Promise.allSettled(
                    ASSETS.map((asset) => cache.add(asset))
                ).then((results) => {
                    const failed = results
                        .map((r, i) => (r.status === 'rejected' ? ASSETS[i] : null))
                        .filter(Boolean);
                    if (failed.length) console.warn('[SW] assets failed to cache:', failed);
                })
            )
            .then(() => self.skipWaiting())
            .catch((err) => console.warn('[SW] install failed:', err))
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames.map((name) => {
                    if (name !== CACHE_NAME) {
                        return caches.delete(name);
                    }
                })
            );
        }).then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);

    // External APIs and CDNs — never intercept, let browser handle natively.
    const networkOnlyHosts = [
        'script.google.com', 'googleapis.com', 'jsdelivr.net',
        'youtube.com', 'ytimg.com', 's.ytimg.com',
        'raw.githubusercontent.com', 'fonts.googleapis.com', 'fonts.gstatic.com'
    ];
    if (networkOnlyHosts.some(h => url.hostname.includes(h))) return;

    // Config is regenerated on every deploy (URL/token can change). Serving a
    // stale copy cache-first silently breaks all future writes for that device,
    // so runtime-config.js must always hit the network (cache only as offline fallback).
    if (url.pathname.endsWith('/js/runtime-config.js')) {
        event.respondWith(
            fetch(event.request)
                .then((response) => {
                    if (response && response.status === 200 && response.type === 'basic') {
                        const copy = response.clone();
                        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
                    }
                    return response;
                })
                .catch(() => caches.match(event.request))
        );
        return;
    }

    // Cache-first for all local static assets: instant serve + background refresh.
    event.respondWith(
        caches.match(event.request).then((cached) => {
            if (cached) {
                // Serve from cache immediately; refresh in background so next visit is current.
                fetch(event.request)
                    .then((response) => {
                        if (response && response.status === 200 && response.type === 'basic') {
                            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, response));
                        }
                    })
                    .catch(() => { });
                return cached;
            }
            // Not in cache yet: fetch, cache, and return.
            return fetch(event.request).then((response) => {
                if (response && response.status === 200 && response.type === 'basic') {
                    const copy = response.clone();
                    caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
                }
                return response;
            }).catch(() => caches.match(event.request));
        })
    );
});
