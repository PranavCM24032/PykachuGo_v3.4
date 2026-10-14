// ==============================
// INITIALIZATION
// ==============================

/**
 * Universal deep-link resolver.
 * Accepts query params (?linkid=XG01 / ?memid=M01) OR path-based links
 * (https://<any host>/XG01 or /M01) and resolves them to a puzzle / meme.
 */
function resolveUniversalLink() {
    const params = new URLSearchParams(window.location.search);

    let linkId = standardizeString(params.get('linkid'));
    let memeId = standardizeString(params.get('memid'));

    // Path-based fallback: last non-empty path segment as the ID.
    // e.g. https://host/XG01 or https://host/Pikachu_v3/M01
    if (!linkId && !memeId) {
        const seg = (window.location.pathname || '').split('/').filter(Boolean).pop();
        if (seg) {
            const std = standardizeString(seg);
            if (MEMES.some(m => standardizeString(m.memeid) === std)) {
                memeId = std;
            } else if (PUZZLES.some(p => standardizeString(p.linkid) === std)) {
                linkId = std;
            }
        }
    }

    const puzzle = linkId ? PUZZLES.find(p => standardizeString(p.linkid) === linkId) || null : null;
    const meme = memeId ? MEMES.find(m => standardizeString(m.memeid) === memeId) || null : null;

    if (puzzle) console.log(`[DeepLink] Puzzle locked via link: ${puzzle.linkid}`);
    if (meme) console.log(`[DeepLink] Meme linked: ${meme.memeid}`);
    return { puzzle, meme };
}

document.addEventListener('DOMContentLoaded', async () => {
    // Sessions are now persistent for a better user experience
    // localStorage.removeItem(CONFIG.STORAGE_KEYS.gameState); 
    // localStorage.removeItem(CONFIG.STORAGE_KEYS.teamInfo); 

    const [puzzlesLoaded, teamsLoaded, memesLoaded] = await Promise.all([
        loadPuzzles(),
        loadTeams(),
        loadMemes()
    ]);
    if (!puzzlesLoaded || !teamsLoaded) {
        showToast('Game data could not be loaded. Please refresh or contact administrator.', 'error');
        console.error('[Startup] Required game data failed to load.', {
            puzzlesLoaded,
            teamsLoaded,
            memesLoaded
        });
        return;
    }
    // Preload the player without delaying the rest of the game if YouTube is
    // unavailable or slow on the current network.
    warmupMemePlayer().catch(() => {});
    initAudio();

    // Warm the end-of-chain celebration while the game is idle. The confetti
    // library downloads once and the synth buffers are built now, so the frame
    // the ball opens has nothing heavy to do and animation + cue stay in sync.
    preloadConfetti().catch(() => { });
    const warmCelebration = () => {
        if (typeof prewarmCelebrationAudio === 'function') prewarmCelebrationAudio();
    };
    if (typeof requestIdleCallback === 'function') {
        requestIdleCallback(warmCelebration, { timeout: 3000 });
    } else {
        setTimeout(warmCelebration, 1200);
    }

    // A reset from the admin panel bumps the game epoch. If this device was
    // last used before that reset, its saved queue/score/progress is stale —
    // wipe it all so every player starts the new run clean.
    //
    // Bounded by an AbortController: on a network that blackholes instead of
    // refusing (captive portal / venue wifi), this fetch used to hang for the
    // browser's full connect timeout and the boot handler never reached the
    // showStep() + power-button wiring below — stranding a returning team on
    // the intro screen with no listeners attached.
    try {
        const epochController = new AbortController();
        const epochTimeout = setTimeout(() => epochController.abort(), 4000);
        try {
            const epochResp = await fetch(`${GOOGLE_SCRIPT_URL}?action=GET_EPOCH&t=${Date.now()}&token=${encodeURIComponent(GOOGLE_SCRIPT_TOKEN)}`, { signal: epochController.signal });
            const epochData = await epochResp.json();
            const serverEpoch = Number(epochData.epoch || 0);
            const localEpoch = Number(localStorage.getItem(CONFIG.STORAGE_KEYS.gameEpoch) || 0);
            if (serverEpoch > localEpoch) {
                Object.values(CONFIG.STORAGE_KEYS).forEach(key => localStorage.removeItem(key));
                if (typeof SESSION_BUFFER_KEY !== 'undefined') localStorage.removeItem(SESSION_BUFFER_KEY);
                localStorage.removeItem('pykachuSheetsRateLimit');
                localStorage.setItem(CONFIG.STORAGE_KEYS.gameEpoch, String(serverEpoch));
                console.log(`[Epoch] Reset detected (${localEpoch} -> ${serverEpoch}); local progress wiped.`);
            }
        } finally {
            clearTimeout(epochTimeout);
        }
    } catch (e) {
        console.warn('Epoch check failed (offline?). Keeping saved progress:', e);
    }

    // Initialize with empty state for a fresh start
    currentTeam = "";
    currentTeamTid = "";
    currentMissionLevel = "";
    sessionId = generateSessionId();
    tabSwitchCount = 0;
    currentPuzzle = null;
    urlLockedPuzzle = null;
    currentLanguage = "PYTHON";

    // Universal link system: ?linkid=XG01 / ?memid=M01 / path-based IDs
    const { puzzle, meme } = resolveUniversalLink();
    if (puzzle && isPuzzleAllowed(puzzle)) {
        urlLockedPuzzle = puzzle;
    } else if (puzzle) {
        // Deep link points at a puzzle that isn't next in the chain — reject it
        showToast(puzzleGateMessage(puzzle), 'error');
    }

    if (urlLockedPuzzle) {
        if (isStartingPuzzle(urlLockedPuzzle)) {
            // Pre-fill the start key for the entry puzzle so deep links one-tap through
            const unlockCodeInput = document.getElementById('unlockCode');
            if (unlockCodeInput) unlockCodeInput.value = urlLockedPuzzle.startCode || "START";
        }
    }

    updateTeamStatus();
    prefillRegistrationForm();
    updatePowerLed();

    // Flow: Loader -> Step 0 (Oak's master rules) -> button click -> Step 1 (Login form)
    showStep(0);

    // Tell the loader which screen we landed on. It holds the splash (and the
    // .booting gate) until this fires, so a remembered trainer never sees step0
    // flash for a moment before being pulled to the login form.
    // On window, not document: CustomEvent does not bubble, and loader.js
    // listens on window.
    window.dispatchEvent(new CustomEvent('app:booted'));

    // Auxiliary power button: short tap = sign in/out, long hold = CRT power.
    const powerButton = document.getElementById('power-button');
    if (powerButton) {
        let pressTimer = null;
        let longPressFired = false;
        const clearPressTimer = () => {
            if (pressTimer) {
                clearTimeout(pressTimer);
                pressTimer = null;
            }
        };
        powerButton.addEventListener('pointerdown', (e) => {
            if (e.pointerType === 'mouse' && e.button !== 0) return;
            longPressFired = false;
            clearPressTimer();
            pressTimer = setTimeout(() => {
                longPressFired = true;
                toggleCrtPower();
            }, 650);
        });
        powerButton.addEventListener('pointerup', () => {
            clearPressTimer();
            if (longPressFired) {
                longPressFired = false;
                return;
            }
            handlePowerTap();
        });
        powerButton.addEventListener('pointercancel', clearPressTimer);
        powerButton.addEventListener('pointerleave', clearPressTimer);
        powerButton.addEventListener('keydown', (e) => {
            if (e.key !== 'Enter' && e.key !== ' ') return;
            e.preventDefault();
            handlePowerTap();
        });
    }

    // Auto-play memes for ?memid=M01 deep links (overlays the start screen)
    if (meme) {
        setTimeout(() => showMemePlayer(meme), 600);
    }

    // Pause heavy animations while the tab is hidden
    document.addEventListener('visibilitychange', () => {
        document.documentElement.classList.toggle('page-hidden', document.hidden);
    });

    // Security is now managed by security.js
    // setTimeout(setupAntiCheat, 500); 

    console.log('Professional Pokédex Initialized - Fresh Session ID:', sessionId);
});

// ==============================
// REFRESH RESUME
// Send a returning team back to the step they were on instead of step 0.
// ==============================
function resumeToLastStep() {
    let savedStep = '0';
    try {
        const savedState = JSON.parse(localStorage.getItem(CONFIG.STORAGE_KEYS.gameState) || '{}');
        if (typeof savedState.currentStep !== 'undefined') savedStep = savedState.currentStep;
    } catch (e) { }

    if (savedStep === 'startcode') {
        // Only land on the key pad when there's still a locked puzzle to open
        if (urlLockedPuzzle) {
            showStep('startcode');
            return;
        }
        savedStep = '2';
    }

    const stepNum = Number(savedStep);

    // Restore the tab-switch tally so a reload can never harvest-clear the
    // anti-cheat count (saveGameState persists it; nothing used to read it back).
    try {
        const restoredState = JSON.parse(localStorage.getItem(CONFIG.STORAGE_KEYS.gameState) || '{}');
        if (typeof restoredState.tabSwitchCount === 'number') {
            tabSwitchCount = restoredState.tabSwitchCount;
        }
    } catch (e) { }

    // Hydrate the live puzzle from the saved id so a returning team that was
    // mid-riddle lands straight back on the riddle (step 3) instead of the
    // scanner. On a fresh reload currentPuzzle is null; without this the
    // `stepNum === 3 && currentPuzzle` branch below is always dead.
    try {
        const savedState = JSON.parse(localStorage.getItem(CONFIG.STORAGE_KEYS.gameState) || '{}');
        if (typeof savedState.currentPuzzleId !== 'undefined' && savedState.currentPuzzleId) {
            const restored = PUZZLES.find(p => p.id === Number(savedState.currentPuzzleId));
            if (restored) currentPuzzle = restored;
        }
    } catch (e) { }

    // Resume is only meaningful from the scanner onward; 0/1 mean "not started".
    if (stepNum === 3 && currentPuzzle) {
        showStep(3); // straight back onto the riddle
        return;
    }
    if (stepNum >= 2) {
        showStep(2); // scanner / next-signal loop
        return;
    }
    showStep(2); // safe default for a returning logged-in team
}

// ==============================
// CLEANUP
// ==============================
window.addEventListener('beforeunload', () => {
    stopQRScanner();
    destroyMemePlayer();
    stopTabMonitoring();
    cleanupHintSystem();

    // clearPenalty() also nulls the handles (raw clearInterval left them
    // truthy-but-dead) and hides #penaltyOverlay.
    clearPenalty();

    saveGameState();
});

window.addEventListener('beforeunload', (e) => {
    if (penaltyActive || hintPenaltyActive) {
        e.preventDefault();
        e.returnValue = 'You are currently serving a penalty. Are you sure you want to leave?';
        return e.returnValue;
    }
});

// ==============================
// AUXILIARY INTERFACE LOGIC
// ==============================
let isCrtOn = true;

function isLoggedIn() {
    return currentTeam && currentTeam.trim() !== "";
}

function updatePowerLed() {
    const indicator = document.getElementById('power-led');
    if (!indicator) return;
    indicator.classList.toggle('session-on', isLoggedIn());
    indicator.classList.toggle('session-idle', !isLoggedIn());
}

function toggleCrtPower() {
    isCrtOn = !isCrtOn;
    const crtScreen = document.getElementById('screen');

    if (crtScreen) {
        if (isCrtOn) {
            crtScreen.style.filter = '';
            crtScreen.style.opacity = '1';
            playSound('powerUp');
        } else {
            crtScreen.style.filter = 'brightness(0) contrast(2)';
            crtScreen.style.opacity = '0.1';
            playSound('click');
        }
    }
}

function prefillRegistrationForm() {
    const info = getTeamInfo();
    if (!info) return;

    const teamInput = document.getElementById('teamName');
    const keyInput = document.getElementById('teamSecurityKey');
    const langSel = document.getElementById('codeLanguage');
    const missionSel = document.getElementById('missionLevel');

    if (teamInput && info.teamName) teamInput.value = info.teamName;
    if (keyInput && info.securityKey) keyInput.value = info.securityKey;
    if (langSel && info.language && langSel.querySelector(`option[value="${info.language}"]`)) {
        langSel.value = info.language;
    }
    if (missionSel && info.mission) {
        const legacyMappings = { 'L2_CHARIZARD': 'L2_GHOST', 'L2_GRENINJA': 'L2_FAIRY' };
        const mappedMission = legacyMappings[info.mission] || info.mission;
        if (missionSel.querySelector(`option[value="${mappedMission}"]`)) {
            missionSel.value = mappedMission;
        }
    }
    if (typeof refreshSelectDisplay === 'function') {
        if (langSel) refreshSelectDisplay(langSel);
        if (missionSel) refreshSelectDisplay(missionSel);
    }
}

function handlePowerTap() {
    if (isLoggedIn()) {
        showConfirmDialog({
            title: 'SIGN OUT',
            message: `Trainer <span class="font-bold text-white">${escapeHTML(currentTeam)}</span><br>Your progress is backed up before sign-out. Continue?`,
            icon: 'power_settings_new',
            iconClass: 'text-red-500',
            titleClass: 'text-red-500',
            accentClass: 'border-red-600/50',
            primaryClass: 'bg-red-600 text-white hover:bg-red-700',
            primaryIcon: 'logout',
            okText: 'LOGOUT',
            cancelText: 'STAY'
        }).then((ok) => {
            if (ok) {
                logoutCurrentUser();
            } else {
                showToast('Stay in battle, trainer!', 'info');
            }
        });
    } else {
        showToast('Trainer sign-in required', 'info');
        showStep(1);
    }
}

function logoutCurrentUser() {
    if (!isLoggedIn()) return;
    loginFlowId++;

    // Leaving mid-riddle is captured by flushPuzzleNotebooksOnUnload() below
    // (shared choke point with page-close), which bumps the tally + notepad
    // before building the PUZZLE_ABANDONED payload � so it lands on the sheet.

    playSound('click');
    if ('vibrate' in navigator) navigator.vibrate(40);

    // Push every unsent mid-game detail (open puzzle notebook + session buffer)
    // to the backend BEFORE the session is cleared, so logout never loses data.
    // Both senders capture globals synchronously at call time (keepalive fetch);
    // anything still blocked by the rate limiter stays buffered for next login.
    flushPuzzleNotebooksOnUnload();
    flushSessionBuffer();

    stopQRScanner();
    destroyMemePlayer();
    stopTabMonitoring();
    cleanupHintSystem();

    // clearPenalty() is the ONLY thing that hides #penaltyOverlay. Clearing the
    // raw timer here left the full-screen z-150 overlay frozen and the app
    // permanently unclickable after a logout during a penalty.
    clearPenalty();

    // Cancel the pending "move to step 4" reveal, unlock the answer field and
    // drop any in-flight Pokémon reveal timers.
    if (typeof revealStepTimer !== 'undefined' && revealStepTimer) {
        clearTimeout(revealStepTimer);
        revealStepTimer = null;
    }
    if (typeof unlockAnswerInput === 'function') unlockAnswerInput();
    if (typeof cancelPokemonReveal === 'function') cancelPokemonReveal();

    Scheduler.stopTimer('puzzleTimer');
    if (puzzleTimerInterval) {
        clearInterval(puzzleTimerInterval);
        puzzleTimerInterval = null;
    }

    penaltyActive = false;
    hintPenaltyActive = false;

    currentTeam = "";
    currentTeamTid = "";
    currentMissionLevel = "";
    sessionId = generateSessionId();
    currentPuzzle = null;
    urlLockedPuzzle = null;
    currentStep = 1;
    tabSwitchCount = 0;
    isPuzzleActive = false;
    resetHintForNewTeam();

    updateTeamStatus();
    updatePowerLed();
    showToast('Trainer signed out. Data backed up!', 'success');
    showStep(0);
}

function handleAuxClick(btnId) {
    playSound('click');
    if ('vibrate' in navigator) navigator.vibrate(20);

    console.log(`Auxiliary Button ${btnId} pressed`);

    // Add a quick flash to the corresponding button
    const btn = document.getElementById(`aux-btn-${btnId}`);
    if (btn) {
        const originalBg = btn.style.background;
        btn.style.background = 'white';
        setTimeout(() => btn.style.background = originalBg, 50);
    }

    // Toggle mute if button 1 is pressed
    if (btnId === 1) {
        window.isMuted = !window.isMuted;
        if (window.isMuted && window.bgMusic) {
            window.bgMusic.pause();
        } else if (!window.isMuted && window.bgMusic && !window.bgMusic.paused) {
            // keep playing
        }
        showToast(window.isMuted ? 'Audio Suspended' : 'Audio Active', window.isMuted ? 'error' : 'success');
    }

    // Toggle Music if button 2 is pressed
    if (btnId === 2) {
        if (!window.bgMusic) {
            window.bgMusic = new Audio('https://play.pokemonshowdown.com/audio/music/battle-trainer.mp3');
            window.bgMusic.loop = true;
            window.bgMusic.volume = 0.15;
        }

        if (window.bgMusic.paused) {
            window.bgMusic.play().catch(e => console.warn("Music play block:", e));
            showToast('BGM Active', 'success');
        } else {
            window.bgMusic.pause();
            showToast('BGM Suspended', 'info');
        }
    }
}

// Map globals
window.toggleCrtPower = toggleCrtPower;
window.handleAuxClick = handleAuxClick;
window.acceptRules = function () {
    playSound('powerUp');
    showStep(1);
};

// ==============================
// DEBUGGING TOOLS
// ==============================
window.testConnection = async function () {
    console.log('Testing connection to Google Sheets...');
    showToast('Testing Uplink...', 'info');

    try {
        console.log('Packet queued. Monitor network tab for "exec" request.');
        setTimeout(() => {
            // We can't know for sure if it worked due to no-cors, but we can assume if no error thrown
            showToast('Uplink Signal Sent', 'success');
        }, 1000);

    } catch (e) {
        console.error('Connection Test Failed:', e);
        showToast('Uplink Failed', 'error');
        alert('Connection Error: ' + e.message + '\nCheck console for details.');
    }
};

// ==============================
// GLOBAL ERROR HANDLING
// ==============================
window.onerror = function (msg, url, lineNo, columnNo, error) {
    const errorData = {
        message: msg,
        script: url,
        line: lineNo,
        column: columnNo,
        stack: error ? error.stack : 'No stack trace'
    };

    console.error('Global Error Caught:', errorData);

    return false; // Let default handler run
};

// The confetti library is fetched once and remembered. Warming it at boot
// (and, failing that, the first time a puzzle is solved) means the reveal frame
// never stalls on a network fetch + script parse while the ball is opening.
const CONFETTI_CDN_URL = 'https://cdn.jsdelivr.net/npm/canvas-confetti@1.6.0/dist/confetti.browser.min.js';
let confettiLoadPromise = null;

function preloadConfetti() {
    if (!confettiLoadPromise) {
        confettiLoadPromise = loadScript(CONFETTI_CDN_URL).catch(err => {
            // Allow a later retry instead of caching a permanent failure.
            confettiLoadPromise = null;
            throw err;
        });
    }
    return confettiLoadPromise;
}

function triggerFinalCelebration() {
    const canvas = document.getElementById('celebrationCanvas');
    const screen = document.getElementById('screen');
    if (!canvas || !screen) return;

    preloadConfetti().then(() => {
        runCelebration(canvas, screen);
    }).catch(err => console.warn('Confetti load failed:', err));
}

// Single reusable gold wash layer, created once and kept in the DOM at
// opacity 0 so the reveal frame doesn't pay to build it. Lives below the
// confetti canvas (z-100) and above the screen content.
let celebrationWash = null;
function getCelebrationWash(screen) {
    if (celebrationWash && celebrationWash.isConnected) return celebrationWash;
    const el = document.createElement('div');
    el.className = 'celebration-wash';
    screen.insertBefore(el, screen.firstChild);
    celebrationWash = el;
    return el;
}

// Confetti choreography, derived from the celebration track (assets/) by onset
// detection: every blast lands on a beat of the song, so the bursts and the
// music read as one performance instead of two. Times are seconds from the
// start of the track; the sparks are the lighter beats between the big hits.
const CELEBRATION_BLASTS = [0, 3.45, 3.94, 4.44, 4.93, 5.43, 5.93, 6.42, 7.41, 7.91, 8.41, 9.40, 10.39, 10.89, 11.38, 11.88, 12.62, 13.37, 14.01, 14.85, 15.75];
const CELEBRATION_SPARKS = [0.97, 1.97, 16.21, 17.42];
const CELEBRATION_BLAST_X = [0.5, 0.2, 0.8];

function runCelebration(canvas, screen) {
    if (typeof confetti === 'undefined') return;

    // Fire the cue on the audio clock FIRST, before the confetti library spins
    // up its worker and we touch the canvas. The decoded track (or synth
    // fallback) is scheduled ahead of the heavy visual work, so it never starts
    // late or past-due. Every burst below is locked to this same start time, so
    // the confetti and the music are one performance.
    const audioStart = (typeof playFinalCelebration === 'function') ? playFinalCelebration(1) : null;

    // Reset and size canvas
    canvas.width = screen.clientWidth;
    canvas.height = screen.clientHeight;

    const myConfetti = confetti.create(canvas, {
        resize: true,
        useWorker: true
    });

    // SCREEN WASH — warm gold, not a full-white strobe. A pure-white flash on
    // the reveal frame would white out the very reveal it celebrates. This is a
    // dedicated opacity layer, so it stays on the compositor and never repaints
    // the scroll container (which used to stutter the confetti underneath).
    const wash = getCelebrationWash(screen);
    wash.style.transition = 'none';
    wash.style.opacity = '0.2';
    requestAnimationFrame(() => {
        wash.style.transition = 'opacity 1.4s ease';
        wash.style.opacity = '0';
    });

    const colors = [
        '#ff0000', // Pokeball Red
        '#3b82f6', // Greatball Blue
        '#ffd700', // Ultra/Gold Yellow
        '#22c55e', // Grass Green
        '#a855f7', // Masterball Purple
        '#ffffff', // Pure White
        '#f97316'  // Fire Orange
    ];

    // A single clock drives both the sound and the confetti: the audio hardware
    // clock while the cue plays, wall-clock time otherwise.
    const hasAudioClock = audioStart != null && typeof getAudioContextTime === 'function' && getAudioContextTime() != null;
    const clock = hasAudioClock ? () => getAudioContextTime() : () => Date.now() / 1000;
    const base = audioStart != null ? audioStart : Date.now() / 1000;

    // Merge the two hit lists into one time-ordered schedule.
    const schedule = [];
    CELEBRATION_BLASTS.forEach((t) => schedule.push([t, 'blast']));
    CELEBRATION_SPARKS.forEach((t) => schedule.push([t, 'star']));
    schedule.sort((a, b) => a[0] - b[0]);

    // Fountains run for as long as the music does (and never past it).
    const lastHit = schedule.length ? schedule[schedule.length - 1][0] : 0;
    const trackDur = (typeof getCelebrationDuration === 'function') ? getCelebrationDuration() : null;
    let displayEnd = lastHit + 1.0;
    if (trackDur) displayEnd = Math.min(displayEnd, trackDur);

    const blastAt = (x) => myConfetti({
        particleCount: 150,
        startVelocity: 45,
        spread: 90,
        origin: { x: x, y: 0.7 },
        colors: colors,
        gravity: 1.2
    });
    const starAt = (x, y) => myConfetti({
        particleCount: 40,
        spread: 100,
        origin: { x: x, y: y },
        shapes: ['star'],
        colors: ['#FFEAB0', '#FFF9E3', '#FACC15']
    });

    let si = 0;
    let blastCount = 0;
    (function frame() {
        const elapsed = clock() - base;

        // Fire every hit whose beat has arrived, on the same clock as the sound.
        while (si < schedule.length && elapsed >= schedule[si][0]) {
            if (schedule[si][1] === 'blast') {
                blastAt(CELEBRATION_BLAST_X[blastCount++ % CELEBRATION_BLAST_X.length]);
            } else {
                starAt(Math.random(), Math.random() - 0.2);
            }
            si++;
        }

        if (elapsed < displayEnd) {
            myConfetti({ particleCount: 3, angle: 60, spread: 55, origin: { x: 0, y: 1 }, colors: colors });
            myConfetti({ particleCount: 3, angle: 120, spread: 55, origin: { x: 1, y: 1 }, colors: colors });
            requestAnimationFrame(frame);
        }
    }());
}

window.onunhandledrejection = function (event) {
    console.error('Unhandled Promise Rejection:', event.reason);
};
