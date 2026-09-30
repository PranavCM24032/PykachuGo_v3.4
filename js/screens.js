// ==============================
// GAME FLOW FUNCTIONS
// ==============================
let stepTransitionTimer = null;
let stepTransitionId = 0;

// Delayed .focus() calls. Without a handle, leaving a step before the delay
// elapsed focused a HIDDEN input and raised the on-screen keyboard on top of
// whatever screen the user had actually moved to.
let pendingFocusTimer = null;

// Every pending timer inside the step-4 reveal (latch, shells, voice line) plus
// the sparkle-removal timeouts. Two overlapping reveals used to add/remove the
// same classes on different clocks, spawn 160 sparkles and speak twice.
let revealTimers = [];
let sparkleTimers = [];

// Monotonic generation counter: a timer from an abandoned reveal can never
// touch the ball even if it fires after the user re-enters step 4.
let revealGeneration = 0;

function cancelPokemonReveal() {
    revealGeneration++;
    revealTimers.forEach(clearTimeout);
    revealTimers = [];
    sparkleTimers.forEach(clearTimeout);
    sparkleTimers = [];
    const stage = document.getElementById('pokemonReveal');
    const ball = document.getElementById('step4RevealBall');
    // Leaving these on would strand a half-open ball on the next entry to
    // step 4 (shells split but no sprite, or vice versa).
    if (stage) stage.classList.remove('reveal-ready');
    if (ball) ball.classList.remove('release-latch', 'pokemon-reveal-open');
    document.querySelectorAll('#pokemonReveal .reveal-sparkle').forEach((n) => n.remove());
    // Chorus members that haven't entered yet would keep talking over the
    // next screen, so drop any pending entrances with the rest of the reveal.
    if (typeof stopCatchVoice === 'function') stopCatchVoice();
}

function scheduleReveal(fn, ms) {
    const id = setTimeout(fn, ms);
    revealTimers.push(id);
    return id;
}

// Step 4 flourish: the caught Pokémon drifts out of its Pokéball.
// The ball drifts in from above, rests on the platform, then plays the
// audio-synced OPEN SEQUENCE (t = 0 when the ball settles):
//   0.00s  latch click + button press            (release-latch)
//   0.21s  shells swing open + warm bloom rises  (pokemon-reveal-open / reveal-ready)
//   0.45s  plasma beam + sparkle/ring particles
//   1.00s  white silhouette materializes -> flash dissolve -> full-color Pokémon
// Pacing is deliberately unhurried: the old version slammed the ball in and
// flashed a white shockwave, which read as a shock rather than a reveal.
function playPokemonReveal() {
    const stage = document.getElementById('pokemonReveal');
    const ball = document.getElementById('step4RevealBall');
    if (!stage || !ball) return;

    // Abandon any reveal still in flight so two timelines can never overlap.
    cancelPokemonReveal();
    const gen = revealGeneration;

    const pokemonName = (typeof currentPuzzle !== 'undefined' && currentPuzzle && currentPuzzle.pokemonName) || '';

    // The name is deliberately NOT rendered — the catch line is voice-only
    // (pokemonName is spoken by speakCatch), so the player identifies the
    // Pokémon from the sprite alone.

    // Reset to the "waiting" state so re-entering step 4 replays cleanly.
    stage.classList.remove('reveal-ready');
    ball.classList.remove('release-latch');
    ball.classList.remove('pokemon-reveal-open');

    // Force a reflow so the bounce animation always restarts from scratch.
    void stage.offsetWidth;

    // Old guard was `if (step4 && !active) return` — when #step4 was missing
    // this short-circuited to FALSE and the callback mutated the ball anyway.
    const stillCurrent = () => {
        if (gen !== revealGeneration) return false;
        const step4 = document.getElementById('step4');
        return !!step4 && step4.classList.contains('active');
    };

    // t=1.044s — ball first rests on the platform (58% of the 1.8s fall)
    scheduleReveal(() => {
        if (!stillCurrent()) return;
        playSound('pokeballDrop', 0.22);
    }, 1044);

    // t=1.53s — second, barely-there contact (85% of 1.8s), quieter
    scheduleReveal(() => {
        if (!stillCurrent()) return;
        playSound('pokeballDrop', 0.12);
    }, 1530);

    // t=1.8s — ball has settled; latch release begins
    scheduleReveal(() => {
        if (!stillCurrent()) return;
        ball.classList.add('release-latch');
        playSound('pokeballOpen');
    }, 1800);

    // t=2.01s — shells swing open, warm bloom and beam rise, Pokémon emerges
    scheduleReveal(() => {
        if (!stillCurrent()) return;
        ball.classList.remove('release-latch');
        ball.classList.add('pokemon-reveal-open');
        stage.classList.add('reveal-ready');
        spawnReleaseSparkles();
        // Exact frame the ball opens. The end-of-chain confetti celebration
        // listens for this instead of running on a timer of its own, so it
        // always lands with the reveal no matter how the fall is retimed.
        document.dispatchEvent(new CustomEvent('pykachu:reveal-open'));
    }, 2010);

    // t=3.2s — announcer speaks the catch name once the reveal has settled
    scheduleReveal(() => {
        if (!stillCurrent()) return;
        speakCatch(pokemonName);
    }, 3200);
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
        sparkleTimers.push(setTimeout(() => s.remove(), 7600));
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
            // Tracked + cleared on step change: leaving within 600ms used to
            // pop the keyboard over whatever screen the user had moved to.
            clearTimeout(pendingFocusTimer);
            pendingFocusTimer = setTimeout(() => {
                const el = document.getElementById('startcode');
                if (el && el.classList.contains('active')) unlockCodeInput.focus();
            }, 600);
        }
    }

    if (stepNumber === 4) {
        // Reset the end-of-chain state so a repeat solve (or a re-entry via
        // resume) always shows fresh: hide the completion modal and restore
        // the "Scan Next Signal" CTA. The solve handler re-configures both
        // for the current puzzle right after this runs.
        const completionMessage = document.getElementById('completionMessage');
        if (completionMessage) completionMessage.classList.add('hidden');
        const nextBtn = document.getElementById('nextSignalBtn');
        if (nextBtn) nextBtn.classList.remove('hidden');

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

        // Focus on answer input (tracked so a fast step change can't focus a
        // hidden field and pop the keyboard on the wrong screen)
        clearTimeout(pendingFocusTimer);
        pendingFocusTimer = setTimeout(() => {
            const answerInput = document.getElementById('puzzleAnswer');
            const el = document.getElementById('step3');
            if (answerInput && el && el.classList.contains('active')) {
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

        // Any step change cancels a delayed focus() and an in-flight reveal.
        clearTimeout(pendingFocusTimer);
        pendingFocusTimer = null;
        // ...but NOT when this call IS the step-4 reveal. The step-4 branch
        // above already called playPokemonReveal(), and reaching this else
        // branch cancelled those 3 timers on the very same tick — the ball
        // dropped and then stayed shut forever. playPokemonReveal() cancels any
        // previous reveal itself, so skipping here is still safe on re-entry.
        if (stepNumber !== 4 && typeof cancelPokemonReveal === 'function') {
            cancelPokemonReveal();
        }

        // Clean up hint system. Unconditional: the hint-confirm path arms a 30s
        // #hintRequestTimeout while hintPenaltyActive is still FALSE, so gating
        // on that flag left the timer armed — it later fired an error toast on
        // whatever screen the player had reached (e.g. the step-4 reveal).
        // cleanupHintSystem() is idempotent.
        cleanupHintSystem();
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
