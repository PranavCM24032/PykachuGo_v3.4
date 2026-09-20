const CACHE_NAME = 'pykachu-go-v1';
const ASSETS = [
    'admin.html',
    'index.html',
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
    'js/fireworks.js',
    'js/main.js',
    'js/security.js',
    'js/include.js',
    'html/step0.html',
    'html/step1.html',
    'html/step2.html',
    'html/startcode.html',
    'html/step3.html',
    'html/step4.html',
    'html/penalty.html',
    'html/hint.html',
    'html/meme.html',
    'data/puzzle.json',
    'data/teams.json',
    'service-worker.js',
    'assets/img/ash.png',
    'assets/img/ash-2.png',
    'assets/img/ash-3.png',
    'assets/img/brock.png',
    'assets/img/jenny.png',
    'assets/img/joy.png',
    'assets/img/oak.png',
    'assets/img/officer-jenny.png',
    'assets/img/poketropy.png'
];

self.addEventListener('install', (event) => {
    self.skipWaiting();
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            return cache.addAll(ASSETS);
        })
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
    // Network-first: always try the server (so fixes propagate immediately),
    // refresh the cache on success, and fall back to cache when offline.
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
});
