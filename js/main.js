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

    await Promise.all([loadPuzzles(), loadTeams(), loadMemes()]);
    // Preload the player without delaying the rest of the game if YouTube is
    // unavailable or slow on the current network.
    warmupMemePlayer().catch(() => {});
    initAudio();

    // A reset from the admin panel bumps the game epoch. If this device was
    // last used before that reset, its saved queue/score/progress is stale —
    // wipe it all so every player starts the new run clean.
    try {
        const epochResp = await fetch(`${GOOGLE_SCRIPT_URL}?action=GET_EPOCH&t=${Date.now()}&token=${encodeURIComponent(GOOGLE_SCRIPT_TOKEN)}`);
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
    } catch (e) {
        console.warn('Epoch check failed (offline?). Keeping saved progress:', e);
    }

    // Initialize with empty state for a fresh start
    currentTeam = "";
    currentTeamTid = "";
    tabSwitchCount = 0;
    currentPuzzle = null;
    urlLockedPuzzle = null;
    currentLanguage = "PYTHON";

    // Restore the returning team's identity and session.
    try {
        const savedTeamInfo = JSON.parse(localStorage.getItem(CONFIG.STORAGE_KEYS.teamInfo) || '{}');
        if (savedTeamInfo.language) currentLanguage = savedTeamInfo.language;
        if (savedTeamInfo.missionLevel) currentMissionLevel = savedTeamInfo.missionLevel;
        if (savedTeamInfo.tid) currentTeamTid = savedTeamInfo.tid;
        if (savedTeamInfo.name) currentTeam = savedTeamInfo.name;
        if (savedTeamInfo.sessionId) sessionId = savedTeamInfo.sessionId;
    } catch (e) { }

    if (!sessionId) {
        sessionId = generateSessionId();
    }

    // Load the returning team's saved queue/solved/score so the deep-link
    // gate below can correctly allow puzzles they have legitimately unlocked.
    loadTeamScoreState();

    // Google Sheets is now the source of truth for the unlock frontier; pull
    // the team's solved/queue ids down so the gate below matches the sheet even
    // after the browser cache was cleared. Falls back to the local cache when
    // the sheet is unreachable or has no record for this team yet.
    if (currentTeamTid) {
        const serverState = await fetchTeamState(currentTeamTid);
        if (serverState) applyServerTeamState(serverState);
    }

    // Restore puzzle progression so the chain gate works across page reloads
    try {
        const savedState = JSON.parse(localStorage.getItem(CONFIG.STORAGE_KEYS.gameState) || '{}');
        const savedStateMatchesTeam = savedState.currentTeamTid
            ? savedState.currentTeamTid === currentTeamTid
            : savedState.currentTeam === currentTeam;

        if (savedStateMatchesTeam && savedState.currentPuzzleId) {
            const savedPuzzle = PUZZLES.find(p => p.id === Number(savedState.currentPuzzleId));
            if (savedPuzzle) currentPuzzle = savedPuzzle;
        }
        if (savedStateMatchesTeam && savedState.urlLockedPuzzleId) {
            const savedLocked = PUZZLES.find(p => p.id === Number(savedState.urlLockedPuzzleId));
            if (savedLocked && isPuzzleAllowed(savedLocked)) urlLockedPuzzle = savedLocked;
        }
    } catch (e) { }

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

    // Refresh resume: returning teams skip rules/registration and pick up
    // right where they left off (showStep → saveGameState persists the step).
    if (currentTeam) {
        resumeToLastStep();
    } else {
        showStep(0);
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

    // Resume is only meaningful from the scanner onward; 0/1 mean "not started".
    if (stepNum === 3 && currentPuzzle) {
        showStep(3); // straight back onto the riddle
        return;
    }
    if (stepNum >= 2) {
        showStep(2); // scanner / next-signal loop
        return;
    }
    showStep(0);
}

// ==============================
// CLEANUP
// ==============================
window.addEventListener('beforeunload', () => {
    stopQRScanner();
    destroyMemePlayer();
    stopTabMonitoring();
    cleanupHintSystem();

    if (penaltyTimer) {
        clearInterval(penaltyTimer);
    }

    if (penaltyDelayTimeout) {
        clearTimeout(penaltyDelayTimeout);
    }

    if (graceCountdownInterval) {
        clearInterval(graceCountdownInterval);
    }

    cancelGracePeriodUI();

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
let isPowerOn = true;

function togglePowerMode() {
    isPowerOn = !isPowerOn;
    const indicator = document.getElementById('power-indicator');
    const crtScreen = document.getElementById('screen');

    if (indicator) {
        indicator.className = `w-2 h-2 rounded-full transition-all ${isPowerOn ? 'power-on' : 'bg-red-900 shadow-none'}`;
    }

    if (crtScreen) {
        if (isPowerOn) {
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
window.togglePowerMode = togglePowerMode;
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

function triggerFinalCelebration() {
    const canvas = document.getElementById('celebrationCanvas');
    const screen = document.getElementById('screen');
    if (!canvas || !screen) return;

    // Lazy-load the heavy confetti library only when celebrating
    loadScript('https://cdn.jsdelivr.net/npm/canvas-confetti@1.6.0/dist/confetti.browser.min.js').then(() => {
        runCelebration(canvas, screen);
    }).catch(err => console.warn('Confetti load failed:', err));
}

function runCelebration(canvas, screen) {
    if (typeof confetti === 'undefined') return;

    // Reset and size canvas
    canvas.width = screen.clientWidth;
    canvas.height = screen.clientHeight;

    const myConfetti = confetti.create(canvas, {
        resize: true,
        useWorker: true
    });

    // 1. SCREEN FLASH EFFECT
    screen.style.transition = 'none';
    screen.style.backgroundColor = 'white';
    setTimeout(() => {
        screen.style.transition = 'background-color 2s ease';
        screen.style.backgroundColor = '';
    }, 100);

    // 2. FOUNTAIN EFFECT (Vibrant Multi-color)
    const end = Date.now() + (15 * 1000);
    const colors = [
        '#ff0000', // Pokeball Red
        '#3b82f6', // Greatball Blue
        '#ffd700', // Ultra/Gold Yellow
        '#22c55e', // Grass Green
        '#a855f7', // Masterball Purple
        '#ffffff', // Pure White
        '#f97316'  // Fire Orange
    ];

    (function frame() {
        myConfetti({
            particleCount: 3,
            angle: 60,
            spread: 55,
            origin: { x: 0, y: 1 },
            colors: colors
        });
        myConfetti({
            particleCount: 3,
            angle: 120,
            spread: 55,
            origin: { x: 1, y: 1 },
            colors: colors
        });

        if (Date.now() < end) {
            requestAnimationFrame(frame);
        }
    }());

    // 3. PERIODIC STAR BURSTS
    const starInterval = setInterval(() => {
        if (Date.now() > end) return clearInterval(starInterval);

        myConfetti({
            particleCount: 40,
            spread: 100,
            origin: { x: Math.random(), y: Math.random() - 0.2 },
            shapes: ['star'],
            colors: ['#FFEAB0', '#FFF9E3', '#FACC15']
        });
    }, 1500);

    // 4. INITIAL GRAND EXPLOSIONS
    const burst = (delay, x) => {
        setTimeout(() => {
            myConfetti({
                particleCount: 150,
                startVelocity: 45,
                spread: 90,
                origin: { x: x, y: 0.7 },
                colors: colors,
                gravity: 1.2
            });
            playSound('success'); // Additional success sounds for impact
        }, delay);
    };

    burst(0, 0.5);   // Center
    burst(400, 0.2); // Left
    burst(800, 0.8); // Right
    burst(1200, 0.5); // Center again
}

window.onunhandledrejection = function (event) {
    console.error('Unhandled Promise Rejection:', event.reason);
};
