// ==============================
// GAME FLOW FUNCTIONS
// ==============================
let stepTransitionTimer = null;
let stepTransitionId = 0;

// Step 4 flourish: the caught Pokémon bursts out of its Pokéball.
// Choreographed, audio-synced OPEN SEQUENCE (t = 0 when the ball settles):
//   0.00s latch click + button press   (release-latch)
//   0.15s shells split + white flash burst (pokemon-reveal-open / reveal-ready)
//   0.35s plasma beam outpour + sparkle/ring particles
//   0.65s white silhouette materializes -> flash dissolve -> full-color Pokémon
function playPokemonReveal() {
    const stage = document.getElementById('pokemonReveal');
    const ball = document.getElementById('step4RevealBall');
    if (!stage || !ball) return;

    // Reset to the "waiting" state so re-entering step 4 replays cleanly.
    stage.classList.remove('reveal-ready');
    ball.classList.remove('release-latch');
    ball.classList.remove('pokemon-reveal-open');

    // Force a reflow so the bounce animation always restarts from scratch.
    void stage.offsetWidth;

    // t=0 — the ball has finished bouncing; the latch release begins.
    setTimeout(() => {
        const step4 = document.getElementById('step4');
        if (step4 && !step4.classList.contains('active')) return;
        ball.classList.add('release-latch');
        playSound('pokeballOpen');
    }, 1300);

    // t=0.15s — shells snap open, flash bursts, energy pours out.
    setTimeout(() => {
        const step4 = document.getElementById('step4');
        if (step4 && !step4.classList.contains('active')) return;
        ball.classList.remove('release-latch');
        ball.classList.add('pokemon-reveal-open');
        stage.classList.add('reveal-ready');
        spawnReleaseSparkles();
    }, 1450);
}

// Falling-star sparkle shower. Many tinytiny stars appear along the top
// edge and drift down the full screen in slow motion — sky to ground.
function spawnReleaseSparkles() {
    const stage = document.getElementById('pokemonReveal');
    if (!stage) return;

    const w = window.innerWidth;
    const h = window.innerHeight;

    for (let i = 0; i < 80; i++) {
        const s = document.createElement('span');
        s.className = 'reveal-sparkle' + (i % 4 === 0 ? ' sparkle-star' : '');

        s.style.left = (Math.random() * w).toFixed(1) + 'px';
        s.style.top = '0px';
        const sway = (Math.random() * 100 - 50);
        const fall = h + 60 + Math.random() * 60;
        s.style.setProperty('--dx', sway.toFixed(1) + 'px');
        s.style.setProperty('--dy', fall.toFixed(1) + 'px');
        s.style.animationDelay = (Math.random() * 1200).toFixed(0) + 'ms';

        stage.appendChild(s);
        setTimeout(() => s.remove(), 7600);
    }
}

function showStep(stepNumber) {
    console.log('Showing step:', stepNumber);

    // Oak's rules screen is a pre-login screen. While a team is signed in it
    // must never be shown — a stray showStep(0) would look like an automatic
    // flick back to the intro during the reveal or login flow.
    if (stepNumber === 0 && typeof currentTeam !== 'undefined' && currentTeam && currentTeam.trim() !== '') {
        return;
    }

    const steps = document.querySelectorAll('.flow-step');
    // 'startcode' is the named start-key entry screen (was the old step 3).
    const targetStep = stepNumber === 'startcode'
        ? document.getElementById('startcode')
        : (document.getElementById(`step${stepNumber}`) || (Number(stepNumber) === 4 ? document.getElementById('step5') : null));

    if (!targetStep) return;

    // Cancel any older transition so a rapid navigation cannot reveal a stale step.
    if (stepTransitionTimer) {
        clearTimeout(stepTransitionTimer);
        stepTransitionTimer = null;
    }
    const transitionId = ++stepTransitionId;

    // Snappy Transition
    const fadeOutMs = 0;
    const fadeInMs = 140;

    // Fade out all currently-active steps (except the target, which may already
    // be active on first paint — avoids the initial load flash).
    steps.forEach(step => {
        if (step !== targetStep && step.classList.contains('active')) {
            step.style.transition = `all ${fadeOutMs}ms ease`;
            step.style.opacity = '0';
            step.style.transform = 'translateY(-10px)';
        }
    });

    stepTransitionTimer = setTimeout(() => {
        stepTransitionTimer = null;
        if (transitionId !== stepTransitionId) return;

        // Hard-remove every active state, then activate ONLY the target.
        // This guarantees exactly one step is ever rendered at a time.
        steps.forEach(step => step.classList.remove('active'));

        targetStep.classList.add('active');
        targetStep.style.animation = 'none';
        targetStep.style.opacity = '0';
        targetStep.style.transform = 'translateY(10px)';
        targetStep.style.transition = `all ${fadeInMs}ms cubic-bezier(0.4, 0, 0.2, 1)`;

        requestAnimationFrame(() => {
            if (transitionId !== stepTransitionId) return;
            targetStep.style.opacity = '1';
            targetStep.style.transform = 'translateY(0)';
        });
    }, fadeOutMs);

    currentStep = stepNumber;

    // Update team name display across steps
    const teamDisplays = ['teamNameDisplay', 'step4TeamName'];
    teamDisplays.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.textContent = currentTeam || 'NO TEAM';
    });

    if (stepNumber === 'startcode') {
        const badgeContainer = document.getElementById('step3BadgeContainer');
        const badgeImg = document.getElementById('gymBadgeImg');
        const unlockCodeInput = document.getElementById('unlockCode');

        if (urlLockedPuzzle) {
            // Gym Badge Integration: show the badge ONLY when the puzzle declares
            // a badgeId (startcode/badge display is optional per puzzle).
            const badgeId = urlLockedPuzzle.badgeId;
            if (badgeId && badgeImg) {
                const badgeUrl = `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/badges/${badgeId}.png`;
                badgeImg.src = badgeUrl;
                if (badgeContainer) {
                    badgeContainer.classList.remove('hidden');
                }
            } else if (badgeContainer) {
                badgeContainer.classList.add('hidden');
            }
        } else {
            if (badgeContainer) badgeContainer.classList.add('hidden');
        }

        if (unlockCodeInput) {
            unlockCodeInput.value = '';
            setTimeout(() => {
                unlockCodeInput.focus();
            }, 600);
        }
    }

    if (stepNumber === 4) {
        // Animate the caught Pokémon bursting out of a Pokéball.
        if (typeof playPokemonReveal === 'function') playPokemonReveal();
    }

    if (stepNumber === 3) {
        isPuzzleActive = true;
        startTabMonitoring();

        // Add mild green glow effect to code container (similar to location clue but green)
        const codeTerminal = document.querySelector('.code-terminal');
        if (codeTerminal) {
            codeTerminal.style.boxShadow =
                '0 0 10px rgba(0, 245, 160, 0.2), ' +
                '0 0 20px rgba(0, 245, 160, 0.1), ' +
                '0 0 30px rgba(0, 245, 160, 0.05)';
            codeTerminal.style.borderColor = 'rgba(0, 245, 160, 0.4)';
            codeTerminal.style.transition = 'box-shadow 0.5s ease, border-color 0.5s ease';
        }

        // Update language badge
        const langBadge = document.getElementById('langBadge');
        if (langBadge) {
            langBadge.textContent = currentLanguage === 'CPP' ? 'C++' : 'PYTHON';
        }

        // Focus on answer input
        setTimeout(() => {
            const answerInput = document.getElementById('puzzleAnswer');
            if (answerInput) {
                answerInput.focus();
                answerInput.value = ''; // Clear previous answer
            }
        }, 100);

        // Setup hint system
        setTimeout(() => {
            setupHintSystem();
        }, 100);

        // Start Timer
        if (!gameStartTime) {
            gameStartTime = new Date();
        }
        startPuzzleTimer();

        // Ensure puzzle is displayed
        if (currentPuzzle) {
            const puzzleQuestion = document.getElementById('puzzleQuestion');
            if (puzzleQuestion) {
                puzzleQuestion.textContent = getPuzzleQuestion(currentPuzzle);
            }

            // Show CSS Pokeball
            const pokeball = document.getElementById('step4Pokeball');
            if (pokeball) {
                pokeball.classList.remove('hidden');
            }
        }
    } else {
        isPuzzleActive = false;
        stopTabMonitoring();

        // Remove green glow effect
        const codeTerminal = document.querySelector('.code-terminal');
        if (codeTerminal) {
            codeTerminal.style.boxShadow = '';
            codeTerminal.style.borderColor = '';
            codeTerminal.style.transition = '';
        }

        // Stop Timer (leaving step 4 — also stops the hidden scheduler loop)
        Scheduler.stopTimer('puzzleTimer');
        if (puzzleTimerInterval) {
            clearInterval(puzzleTimerInterval);
            puzzleTimerInterval = null;
        }

        // Clean up hint system
        if (hintPenaltyActive) {
            cleanupHintSystem();
        }
    }

    saveGameState();
}

function updateTeamStatus() {
    const teamDisplays = ['teamNameInput', 'teamNameDisplay', 'step4TeamName'];
    const hasTeam = currentTeam && currentTeam.trim() !== "";
    const displayName = hasTeam ?
        (currentTeam.length > 20 ? currentTeam.substring(0, 20) + '...' : currentTeam) :
        'NO TEAM';

    teamDisplays.forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.textContent = displayName;
        }
    });

    // Update LVL and TYPE indicators
    const lvlEl = document.getElementById('teamLevelDisplay');
    const typeEl = document.getElementById('teamTypeDisplay');

    // Status Item Wrappers
    const lvlWrapper = document.getElementById('statusLvl');
    const teamWrapper = document.getElementById('statusTeam');
    const typeWrapper = document.getElementById('statusType');

    if (hasTeam && currentMissionLevel) {
        // Parse missionLevel like "L1_GRASS"
        const parts = currentMissionLevel.split('_');
        const lvl = (parts[0] || "L1").replace('L', '').padStart(2, '0');
        const type = parts[1] || "NORMAL";

        if (lvlEl) lvlEl.textContent = lvl;
        if (typeEl) typeEl.textContent = type;

        // Transition to Green (Filled)
        [lvlWrapper, teamWrapper, typeWrapper].forEach(w => {
            if (w) {
                w.classList.remove('is-empty');
                w.classList.add('is-filled');
            }
        });

        // Update Team Icon to active version
        const teamIcon = teamWrapper?.querySelector('.material-symbols-rounded');
        if (teamIcon) teamIcon.textContent = 'verified_user';
    } else {
        if (lvlEl) lvlEl.textContent = "00";
        if (typeEl) typeEl.textContent = "SYSTEM";

        // Revert to Red (Empty)
        [lvlWrapper, teamWrapper, typeWrapper].forEach(w => {
            if (w) {
                w.classList.remove('is-filled');
                w.classList.add('is-empty');
            }
        });

        // Reset Team Icon
        const teamIcon = teamWrapper?.querySelector('.material-symbols-rounded');
        if (teamIcon) teamIcon.textContent = 'shield_person';
    }
}

// ==============================
// 1. PERFORMANCE & SCHEDULING SYSTEM
// ==============================
const Scheduler = {
    timers: new Map(),

    // Lightweight interval-based timer (far cheaper than a 60fps rAF loop)
    startSmoothTimer(id, callback) {
        if (this.timers.has(id)) this.stopTimer(id);
        this.timers.set(id, setInterval(callback, 1000));
    },

    stopTimer(id) {
        if (this.timers.has(id)) {
            clearInterval(this.timers.get(id));
            this.timers.delete(id);
        }
    }
};

function startPuzzleTimer() {
    Scheduler.startSmoothTimer('puzzleTimer', updatePuzzleTimer);
}

function updatePuzzleTimer() {
    const timerElement = document.getElementById('puzzleTimer');
    if (!timerElement || !gameStartTime) return;

    const diff = Math.floor((new Date() - gameStartTime) / 1000);
    const mins = Math.floor(diff / 60).toString().padStart(2, '0');
    const secs = (diff % 60).toString().padStart(2, '0');
    timerElement.textContent = `${mins}:${secs}`;
}

// ==============================
// MANUAL ENTRY HANDLERS
// ==============================
function showManualEntry() {
    const container = document.getElementById('manualEntryContainer');
    if (container) {
        container.classList.remove('hidden');
        document.getElementById('manualSignalId')?.focus();
    }
}

function hideManualEntry() {
    const container = document.getElementById('manualEntryContainer');
    if (container) {
        container.classList.add('hidden');
    }
}

function submitManualEntry() {
    const input = document.getElementById('manualSignalId');
    if (!input) return;

    const signalId = input.value.trim().toUpperCase();
    if (!signalId) {
        showToast('Enter a valid Signal ID', 'error');
        return;
    }

    if (signalId.length > 50) {
        showToast('Max 50 characters', 'error');
        return;
    }

    console.log('Manual Signal Entry:', signalId);
    handleQRScanResult(signalId);

    // Reset and close
    input.value = '';
    hideManualEntry();
}
