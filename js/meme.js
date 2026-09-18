// ==============================
// MEME QR PLAYER — YouTube IFrame API (Infinite Loop)
// ==============================
let memePlayer = null;
let ytApiReadyPromise = null;
let memePlayerReadyPromise = null;
let memePlayerPreloaded = false;

// ── Load YouTube IFrame API lazily, with a shared promise ─────────────────────
function ensureYTApiLoaded() {
    if (ytApiReadyPromise) return ytApiReadyPromise;
    ytApiReadyPromise = new Promise((resolve, reject) => {
        if (window.YT && window.YT.Player) { resolve(); return; }

        let settled = false;
        const finish = (callback, value) => {
            if (settled) return;
            settled = true;
            clearTimeout(timeout);
            callback(value);
        };
        const timeout = setTimeout(() => {
            finish(reject, new Error('YouTube player did not load in time'));
        }, 10000);

        const tag = document.createElement('script');
        tag.id = 'yt-iframe-api-script';
        tag.src = 'https://www.youtube.com/iframe_api';
        tag.async = true;
        const prevReady = window.onYouTubeIframeAPIReady;
        window.onYouTubeIframeAPIReady = () => {
            if (typeof prevReady === 'function') prevReady();
            if (window.YT && window.YT.Player) finish(resolve);
        };
        tag.onload = () => {
            if (window.YT && window.YT.Player) finish(resolve);
        };
        tag.onerror = () => finish(reject, new Error('Unable to load YouTube player'));
        document.head.appendChild(tag);
    });
    return ytApiReadyPromise;
}

function createMemePlayerInstance(videoId, start, end) {
    return new YT.Player('memePlayerDiv', {
        height: '100%',
        width: '100%',
        videoId: videoId,
        playerVars: {
            autoplay:        0,
            controls:        0,
            modestbranding:  1,
            rel:             0,
            showinfo:        0,
            iv_load_policy:  3,
            disablekb:       1,
            playsinline:     1,
            enablejsapi:     1,
            mute:            1,
            loop:            0,
            playlist:        videoId,
            start:           start,
            end:             end,
            origin:          window.location.origin
        },
        events: {
            onReady: function (e) {
                e.target.pauseVideo();
                e.target.setVolume(100);
            },
            onStateChange: function (e) {
                if (e.data === YT.PlayerState.ENDED) {
                    try { memePlayer.seekTo(start); memePlayer.playVideo(); } catch (_) { }
                }
            }
        }
    });
}

function warmupMemePlayer() {
    if (memePlayerPreloaded) return Promise.resolve();
    if (memePlayerReadyPromise) return memePlayerReadyPromise;

    memePlayerReadyPromise = ensureYTApiLoaded().then(() => {
        const firstMeme = Array.isArray(MEMES) && MEMES.length ? MEMES[0] : null;
        const warmupId = firstMeme ? extractVideoId(firstMeme.ytlink) : '';
        if (!warmupId) return;

        const start = Number(firstMeme.starttime) || 0;
        const end = normalizeMemeEndTime(start, firstMeme.endtime);

        return new Promise(resolve => {
            const container = document.getElementById('memePlayerContainer');
            if (!container) { resolve(); return; }

            const playerDiv = document.getElementById('memePlayerDiv');
            if (!playerDiv) { resolve(); return; }

            destroyMemePlayer();
            memePlayer = createMemePlayerInstance(warmupId, start, end);
            memePlayerPreloaded = true;

            const readyChecker = setInterval(() => {
                if (memePlayer && typeof memePlayer.getPlayerState === 'function') {
                    clearInterval(readyChecker);
                    resolve();
                }
            }, 50);

            setTimeout(() => {
                clearInterval(readyChecker);
                resolve();
            }, 3000);
        });
    }).catch((error) => {
        memePlayerReadyPromise = null;
        throw error;
    });

    return memePlayerReadyPromise;
}

// Warm the API up immediately so memes open faster.
if (document.readyState === 'complete' || document.readyState === 'interactive') {
    ensureYTApiLoaded().catch(() => {});
} else {
    document.addEventListener('DOMContentLoaded', () => ensureYTApiLoaded().catch(() => {}));
}

// ── URL helpers ───────────────────────────────────────────────────────────────
function extractVideoId(url) {
    const text = String(url || '').trim();
    if (!text) return '';

    const rawIdMatch = text.match(/^[A-Za-z0-9_-]{11}$/);
    if (rawIdMatch) return rawIdMatch[0];

    try {
        const parsed = new URL(text);
        const hostname = parsed.hostname.toLowerCase();

        if (hostname.includes('youtu.be')) {
            return parsed.pathname.slice(1).split(/[/?#]/)[0] || '';
        }

        if (hostname.includes('youtube.com') || hostname.includes('m.youtube.com')) {
            const searchId = parsed.searchParams.get('v');
            if (searchId) return searchId;
            const pathMatch = parsed.pathname.match(/(?:\/embed\/|\/shorts\/|\/watch\/|\/v\/|\/u\/\w\/)([^/?#]+)/);
            if (pathMatch) return pathMatch[1];
        }
    } catch (e) {
        // not a full URL, fall back to regex parsing below
    }

    const regExp = /^.*(?:youtu\.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=|shorts\/)([^#&?]*).*/;
    const match = text.match(regExp);
    return (match && match[1] && match[1].length >= 11) ? match[1].split('/')[0] : '';
}

function normalizeMemeEndTime(start, end) {
    const startTime = Number(start) || 0;
    const endTime = Number(end) || 0;
    return endTime > startTime ? endTime : undefined;
}

// ── Fit a 9:16 player so it COVERS the Pokedex screen ────────────────────────
// Guaranteed crop: 40px top (YT title bar) and 56px bottom (play/pause/skip
// control bar), so no YT chrome is ever visible. The video still fills the
// whole screen edge-to-edge.
const MEME_TOP_CROP    = 40;
const MEME_BOTTOM_CROP = 56;

function fitMemePlayer() {
    const clip = document.getElementById('memeVideoClip');
    const player = document.getElementById('memePlayerDiv');
    if (!clip || !player || clip.clientWidth === 0) return;
    const cw = clip.clientWidth;
    const ch = clip.clientHeight;
    const w = Math.max(cw, (ch + MEME_TOP_CROP + MEME_BOTTOM_CROP) * 9 / 16);
    const h = w * 16 / 9;
    player.style.width  = Math.round(w) + 'px';
    player.style.height = Math.round(h) + 'px';
    player.style.left   = Math.round((cw - w) / 2) + 'px';
    player.style.top    = (-MEME_TOP_CROP) + 'px';
}

// Re-fit whenever the screen area resizes (rotation / orientation change)
(function initFitObserver() {
    const clip = document.getElementById('memeVideoClip');
    if (clip && 'ResizeObserver' in window) {
        new ResizeObserver(() => fitMemePlayer()).observe(clip);
    }
    window.addEventListener('resize', fitMemePlayer);
})();

// ── Player lifecycle ──────────────────────────────────────────────────────────
function destroyMemePlayer() {
    if (memePlayer) {
        try { memePlayer.destroy(); } catch (e) { }
        memePlayer = null;
    }
}

function showMemePlayer(meme) {
    const videoId = extractVideoId(meme?.ytlink || meme?.link || meme?.memeid || '');
    if (!videoId) {
        showToast('Invalid meme link', 'error');
        processingQR = false;
        return;
    }

    const container = document.getElementById('memePlayerContainer');
    const playerDiv = document.getElementById('memePlayerDiv');
    if (!container || !playerDiv) return;

    container.classList.remove('hidden');

    const start = Number(meme?.starttime) || 0;
    const end   = normalizeMemeEndTime(start, meme?.endtime);

    function buildPlayer() {
        memePlayer = new YT.Player('memePlayerDiv', {
            height: '100%',
            width: '100%',
            videoId: videoId,
            playerVars: {
                autoplay:        1,
                controls:        0,
                modestbranding:  1,
                rel:             0,
                showinfo:        0,
                iv_load_policy:  3,
                disablekb:       1,
                playsinline:     1,
                enablejsapi:     1,
                mute:            1,       // mute=1 helps autoplay on modern browsers
                loop:            1,       // native infinite loop
                playlist:        videoId, // required for loop to work in IFrame API
                start:           start,
                end:             end,
                origin:          window.location.origin
            },
            events: {
                onReady: function (e) {
                    e.target.playVideo();
                    setTimeout(() => {
                        try { e.target.unMute(); e.target.setVolume(100); } catch (_) { }
                    }, 150);
                },
                onStateChange: function (e) {
                    if (e.data === YT.PlayerState.ENDED) {
                        try { memePlayer.seekTo(start); memePlayer.playVideo(); } catch (_) { }
                    }
                },
                onError: function (e) {
                    console.warn('YouTube player error:', e.data);
                    showToast('Unable to play meme clip. Please try again later.', 'error');
                    processingQR = false;
                    backToScanner();
                }
            }
        });
    }

    function playWithPlayer() {
        if (memePlayer && typeof memePlayer.loadVideoById === 'function') {
            try {
                memePlayer.loadVideoById({ videoId: videoId, startSeconds: start, endSeconds: end });
                memePlayer.playVideo();
                setTimeout(() => {
                    try { memePlayer.unMute(); memePlayer.setVolume(100); } catch (_) { }
                }, 150);
                return;
            } catch (e) {
                console.warn('Meme reuse failed, rebuilding player:', e);
            }
        }
        buildPlayer();
    }

    const unavailable = () => {
        showToast('Unable to load the meme player. Please try again later.', 'error');
        backToScanner();
    };

    requestAnimationFrame(() => {
        fitMemePlayer();
        warmupMemePlayer()
            .then(() => {
                if (!window.YT || !window.YT.Player) throw new Error('YouTube player unavailable');
                playWithPlayer();
            })
            .catch(unavailable);
    });
}

function backToScanner() {
    processingQR = false;
    destroyMemePlayer();
    const container = document.getElementById('memePlayerContainer');
    if (container) container.classList.add('hidden');
    const hasTeam = typeof currentTeam !== 'undefined' && currentTeam.trim() !== '';
    const target = hasTeam ? 2 : 0;
    if (typeof showStep === 'function') {
        showStep(target);
    } else if (typeof startQRScanner === 'function') {
        startQRScanner();
    }
}

// First tap on video = unmute
function memeAreaTapped() {
    if (memePlayer && memePlayer.unMute) {
        try { memePlayer.unMute(); memePlayer.setVolume(100); } catch (_) { }
    }
}

window.showMemePlayer  = showMemePlayer;
window.backToScanner   = backToScanner;
window.memeAreaTapped  = memeAreaTapped;
