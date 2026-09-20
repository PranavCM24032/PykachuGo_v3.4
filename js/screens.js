// ==============================
// GAME FLOW FUNCTIONS
// ==============================
function showStep(stepNumber) {
    console.log('Showing step:', stepNumber);

    const steps = document.querySelectorAll('.flow-step');
    // 'startcode' is the named start-key entry screen (was the old step 3).
    const targetStep = stepNumber === 'startcode'
        ? document.getElementById('startcode')
        : (document.getElementById(`step${stepNumber}`) || (Number(stepNumber) === 4 ? document.getElementById('step5') : null));

    if (!targetStep) return;

    // Snappy Transition
    const fadeOutMs = 120;
    const fadeInMs = 220;

    // Fade out all currently-active steps (except the target, which may already
    // be active on first paint — avoids the initial load flash).
    steps.forEach(step => {
        if (step !== targetStep && step.classList.contains('active')) {
            step.style.transition = `all ${fadeOutMs}ms ease`;
            step.style.opacity = '0';
            step.style.transform = 'translateY(-10px)';
        }
    });

    setTimeout(() => {
        // Hard-remove every active state, then activate ONLY the target.
        // This guarantees exactly one step is ever rendered at a time.
        steps.forEach(step => step.classList.remove('active'));

        targetStep.classList.add('active');
        targetStep.style.opacity = '0';
        targetStep.style.transform = 'translateY(10px)';
        targetStep.style.transition = `all ${fadeInMs}ms cubic-bezier(0.4, 0, 0.2, 1)`;

        // Trigger reflow
        targetStep.offsetHeight;

        targetStep.style.opacity = '1';
        targetStep.style.transform = 'translateY(0)';
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
        // Fireworks celebrate the solve once the step has faded in.
        setTimeout(() => {
            if (typeof startPointBlastSequence === 'function') {
                startPointBlastSequence();
            }
        }, 350);
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
