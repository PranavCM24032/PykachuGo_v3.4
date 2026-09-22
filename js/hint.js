// ==============================
// HINT SYSTEM FUNCTIONS
// ==============================
function isHintValid(hint) {
    if (hint === null || hint === undefined) return false;
    if (typeof hint === 'boolean') return hint === true;
    if (typeof hint === 'string') {
        const lower = hint.toLowerCase().trim();
        return lower !== "none" && lower !== "false" && lower !== "" && lower !== "null";
    }
    return false;
}

function setupHintSystem() {
    console.log('Setting up hint system...');
    if (!currentPuzzle || !CONFIG.FEATURES.hintSystem) return;

    const hintContainer = document.getElementById('hintContainer');
    const hintRequestBtn = document.getElementById('hintRequestBtn');

    // Attempt to match hint button anywhere in step container if ID is duplicate
    const activeHintBtn = hintRequestBtn || document.querySelector(`#step${currentStep} #hintRequestBtn`);

    if (!hintContainer) return;

    currentPuzzleHint = currentPuzzle.hint;

    // VALIDATION: null/undefined/false/"none"/"" → no hint button
    const isValidHint = isHintValid(currentPuzzleHint);

    if (isValidHint) {
        console.log('Hint detected. Activating UI.');
        hintContainer.classList.remove('hidden');

        // Reset UI Components
        const hintDisplay = document.getElementById('hintDisplay');
        if (hintDisplay) hintDisplay.classList.add('hidden');
        if (document.getElementById('hintRequestOverlay'))
            document.getElementById('hintRequestOverlay').classList.add('hidden');
        if (document.getElementById('hintPenaltyOverlay'))
            document.getElementById('hintPenaltyOverlay').classList.add('hidden');

        // Show Request Button
        if (activeHintBtn) {
            activeHintBtn.classList.remove('hidden');
            activeHintBtn.style.display = ''; // Clear inline styles
        } else if (hintRequestBtn) {
            hintRequestBtn.classList.remove('hidden');
        }

        // Setup Penalty Display
        const penaltyTime = currentPuzzle.hintPenalty || 60;
        const penaltyTimeEl = document.getElementById('hintPenaltyTime');
        if (penaltyTimeEl) penaltyTimeEl.textContent = `${penaltyTime}`;

        // Load state for analytics or tracking only.
        loadHintState();
        // NOTE: hint is NOT auto-shown on load. The button stays visible so the
        // player can re-open it freely; requestHint() will always charge the penalty.
    } else {
        console.log('No valid hint available (false/none). Hiding UI.');
        hintContainer.classList.add('hidden');
        if (activeHintBtn) activeHintBtn.classList.add('hidden');
        else if (hintRequestBtn) hintRequestBtn.classList.add('hidden');
    }
}

function loadHintState() {
    const hintState = JSON.parse(localStorage.getItem(CONFIG.STORAGE_KEYS.hintState) || '{}');
    const teamKey = `${currentTeam}_${currentPuzzle?.id}`;

    if (currentPuzzle && currentTeam && hintState[teamKey]) {
        currentPuzzle.hintUsed = hintState[teamKey].used || false;
        // Do not auto-show hint on load, user must request it again each time.
    } else {
        // Reset hint used status for new team
        currentPuzzle.hintUsed = false;
        hintDisplayed = false;
    }
}

function saveHintState() {
    const hintState = JSON.parse(localStorage.getItem(CONFIG.STORAGE_KEYS.hintState) || '{}');
    if (currentPuzzle && currentTeam) {
        const teamKey = `${currentTeam}_${currentPuzzle.id}`;
        hintState[teamKey] = {
            used: currentPuzzle.hintUsed || false,
            usedAt: new Date().toISOString(),
            team: currentTeam,
            puzzleId: currentPuzzle.id
        };
        localStorage.setItem(CONFIG.STORAGE_KEYS.hintState, JSON.stringify(hintState));
    }
}

function requestHint() {
    console.log('Hint requested.');
    if (!currentPuzzle) return;

    // Re-opening a hint already paid for is free — show it directly,
    // no confirmation/penalty timer round-trip.
    if (currentPuzzle.hintUsed) {
        showHint();
        return;
    }

    if (!currentPuzzleHint && currentPuzzle.hint) {
        currentPuzzleHint = currentPuzzle.hint;
    }
    if (!currentPuzzleHint) {
        showToast('No hint available for this puzzle.', 'info');
        return;
    }

    // Update penalty time text in overlay dynamically from currentPuzzle.hintPenalty
    const penaltyTime = (currentPuzzle.hintPenalty && currentPuzzle.hintPenalty > 0) ? currentPuzzle.hintPenalty : 60;
    const penaltyTimeEl = document.getElementById('hintPenaltyTime');
    if (penaltyTimeEl) penaltyTimeEl.textContent = `${penaltyTime}`;

    // Always require confirmation and penalty before revealing the hint
    const overlay = document.getElementById('hintRequestOverlay');
    const container = document.getElementById('hintContainer');
    if (container) container.classList.remove('hidden'); // Ensure visible
    if (overlay) overlay.classList.remove('hidden');

    // Auto-cancel if ignored
    const requestTimeout = (CONFIG.HINT_SETTINGS?.hintRequestTimeout && CONFIG.HINT_SETTINGS.hintRequestTimeout > 0)
        ? CONFIG.HINT_SETTINGS.hintRequestTimeout * 1000
        : 30000;

    if (hintRequestTimeout) clearTimeout(hintRequestTimeout);
    hintRequestTimeout = setTimeout(() => {
        cancelHintRequest();
        showToast('Hint request timed out', 'error');
    }, requestTimeout);
}

function confirmHintRequest() {
    clearTimeout(hintRequestTimeout);
    hintRequestConfirmed = true;

    // Hide confirmation overlay
    const overlay = document.getElementById('hintRequestOverlay');
    if (overlay) overlay.classList.add('hidden');

    // START THE COUNTDOWN TIMER (Instead of completing immediately)
    startHintPenalty();
}

function cancelHintRequest() {
    clearTimeout(hintRequestTimeout);
    hintRequestConfirmed = false;

    // Hide overlay & stop timer if it was running
    const overlay = document.getElementById('hintRequestOverlay');
    if (overlay) overlay.classList.add('hidden');

    if (hintPenaltyActive) {
        clearInterval(hintPenaltyTimer);
        hintPenaltyTimer = null;
        hintPenaltyActive = false;
        hintMalpracticePenaltyRunning = false;
        stopHintTabMonitoring();
        const penaltyOverlay = document.getElementById('hintPenaltyOverlay');
        if (penaltyOverlay) penaltyOverlay.classList.add('hidden');
    }

    playSound('error');
}

function startHintPenalty() {
    if (hintPenaltyActive) return;
    if (!currentPuzzle) {
        showToast('No puzzle loaded for hint.', 'error');
        return;
    }

    hintPenaltyActive = true;
    hintTabSwitchDuringPenalty = false;
    hintTabSwitchCount = 0;

    // Visibility Check
    const hintContainer = document.getElementById('hintContainer');
    if (hintContainer) hintContainer.classList.remove('hidden');

    // Initialize Timer
    hintPenaltySeconds = (currentPuzzle.hintPenalty && currentPuzzle.hintPenalty > 0) ? currentPuzzle.hintPenalty : 60;

    // Show Overlay
    const penaltyOverlay = document.getElementById('hintPenaltyOverlay');
    const timerDisplay = document.getElementById('hintTimerDisplay');
    const timerRing = document.querySelector('.hint-penalty-timer-ring');
    const warningMsg = document.getElementById('hintWarningMessage');

    if (penaltyOverlay) penaltyOverlay.classList.remove('hidden');
    if (timerDisplay) timerDisplay.textContent = hintPenaltySeconds;
    if (warningMsg) warningMsg.classList.add('hidden');

    // Reset Ring Animation
    if (timerRing) {
        timerRing.style.animation = 'none';
        void timerRing.offsetWidth;
        timerRing.style.animation = `hint-countdown ${hintPenaltySeconds}s linear forwards`;
    }

    // Start Ticking
    if (hintPenaltyTimer) clearInterval(hintPenaltyTimer);
    hintPenaltyTimer = setInterval(updateHintPenaltyTimer, 1000);

    // Start Monitoring
    startHintTabMonitoring();

    playSound('hintStart');
}

function updateHintPenaltyTimer() {
    if (!hintPenaltyActive) return;

    hintPenaltySeconds--;

    // Update display
    const timerDisplay = document.getElementById('hintTimerDisplay');
    if (timerDisplay) {
        timerDisplay.textContent = hintPenaltySeconds;
    }

    if (hintPenaltySeconds <= 0) {
        completeHintPenalty();
    }
}

function completeHintPenalty() {
    clearInterval(hintPenaltyTimer);
    hintPenaltyTimer = null;
    hintPenaltyActive = false;

    if (!currentPuzzle) {
        showToast('No puzzle loaded for hint.', 'error');
        return;
    }

    // Hide penalty overlay
    document.getElementById('hintPenaltyOverlay').classList.add('hidden');

    // Stop tab monitoring
    stopHintTabMonitoring();

    // Show the hint (usage already counted via the hint request bump)
    showHint();

    playSound('hintReveal');
    showToast('Hint unlocked!', 'success');
}

// ==============================
// VISIBILITY MONITORING for HINT
// ==============================
function startHintTabMonitoring() {
    document.addEventListener('visibilitychange', handleHintVisibilityChange);
    window.addEventListener('blur', handleHintWindowBlur);
}

function stopHintTabMonitoring() {
    document.removeEventListener('visibilitychange', handleHintVisibilityChange);
    window.removeEventListener('blur', handleHintWindowBlur);
}

function handleHintVisibilityChange() {
    if (document.hidden && hintPenaltyActive) {
        handleHintTabSwitch();
    }
}

function handleHintWindowBlur() {
    if (hintPenaltyActive) {
        // Immediate check or small delay
        setTimeout(() => {
            if (document.hidden || !document.hasFocus()) {
                handleHintTabSwitch();
            }
        }, 100);
    }
}

function handleHintTabSwitch() {
    if (!hintPenaltyActive || hintMalpracticePenaltyRunning) return;
    hintMalpracticePenaltyRunning = true;

    // Pause the hint countdown while the malpractice penalty runs.
    if (hintPenaltyTimer) {
        clearInterval(hintPenaltyTimer);
        hintPenaltyTimer = null;
    }

    // FIRST: run the 15s MALPRACTICE penalty to completion...
    runBlockingPenalty(function () {
        // SECOND: once that's over, reset the hint countdown and run it to its finish.
        if (hintPenaltyActive) {
            resumeHintPenalty();
        }
        hintMalpracticePenaltyRunning = false;
    });
}

function resumeHintPenalty() {
    if (!hintPenaltyActive) return;

    hintTabSwitchDuringPenalty = true;
    hintTabSwitchCount++;
    tabSwitchCount++;

    // RESET TIMER to full duration
    hintPenaltySeconds = (currentPuzzle.hintPenalty && currentPuzzle.hintPenalty > 0) ? currentPuzzle.hintPenalty : 60;

    const timerDisplay = document.getElementById('hintTimerDisplay');
    if (timerDisplay) timerDisplay.textContent = hintPenaltySeconds;

    // Re-show the hint penalty overlay (it may have been covered by the penalty overlay)
    const hintPenaltyOverlay = document.getElementById('hintPenaltyOverlay');
    if (hintPenaltyOverlay) hintPenaltyOverlay.classList.remove('hidden');

    // Show warning message
    const warningMessage = document.getElementById('hintWarningMessage');
    const warningText = document.getElementById('tabSwitchWarning');
    if (warningMessage && warningText) {
        warningText.textContent = 'Tab switch detected! Timer reset.';
        warningMessage.classList.remove('hidden');
    }

    // Reset animation
    const timerRing = document.querySelector('.hint-penalty-timer-ring');
    if (timerRing) {
        timerRing.style.animation = 'none';
        void timerRing.offsetHeight; // Force reflow
        timerRing.style.animation = `hint-countdown ${hintPenaltySeconds}s linear forwards`;
    }

    // Restart the countdown
    if (hintPenaltyTimer) clearInterval(hintPenaltyTimer);
    hintPenaltyTimer = setInterval(updateHintPenaltyTimer, 1000);

    playSound('penaltyReset');
    console.log('Hint timer restarted after malpractice penalty.');
}

function showHint() {
    if (!currentPuzzle) {
        showToast('No puzzle loaded for hint.', 'error');
        return;
    }

    if (!currentPuzzleHint && currentPuzzle && currentPuzzle.hint) {
        currentPuzzleHint = currentPuzzle.hint;
    }
    if (!currentPuzzleHint) {
        showToast('No hint available for this puzzle.', 'info');
        return;
    }

    const hintContainer = document.getElementById('hintContainer'); // Ensure parent is visible
    const hintDisplay = document.getElementById('hintDisplay');
    const hintText = document.getElementById('hintText');
    const hintRequestBtn = document.getElementById('hintRequestBtn');

    if (hintContainer) hintContainer.classList.remove('hidden'); // Force visibility

    if (hintDisplay && hintText) {
        hintText.textContent = currentPuzzleHint;
        hintDisplay.classList.remove('hidden');

        // Hide the hint request button
        if (hintRequestBtn) {
            hintRequestBtn.classList.add('hidden');
        }
    }

    const hintRequestOverlay = document.getElementById('hintRequestOverlay');
    const hintPenaltyOverlay = document.getElementById('hintPenaltyOverlay');
    if (hintRequestOverlay) hintRequestOverlay.classList.add('hidden');
    if (hintPenaltyOverlay) hintPenaltyOverlay.classList.add('hidden');

    hintDisplayed = true;

    // Mark hint as used (scoring) + flag it on the sheet right away.
    // HINT_USED fires on EVERY reveal so a lost/throttled first request never
    // leaves the sheet at 0; the once-per-puzzle throttle + idempotent backend
    // keep repeated re-opens from spamming the event log.
    if (currentPuzzle) {
        const firstUse = !currentPuzzle.hintUsed;
        if (firstUse) {
            notepadBump('hint');
        }
        currentPuzzle.hintUsed = true;
        saveHintState();
        if (typeof submitToGoogleSheets === 'function') {
            submitToGoogleSheets('HINT_USED', {});
        }
    }
}

function closeHintPopup() {
    const hintDisplay = document.getElementById('hintDisplay');
    if (hintDisplay) hintDisplay.classList.add('hidden');

    const hintRequestOverlay = document.getElementById('hintRequestOverlay');
    const hintPenaltyOverlay = document.getElementById('hintPenaltyOverlay');
    if (hintRequestOverlay) hintRequestOverlay.classList.add('hidden');
    if (hintPenaltyOverlay) hintPenaltyOverlay.classList.add('hidden');

    // RE-VALIDATE before showing button again.
    // The button reappears even when the hint was already paid for: re-opening
    // is free (requestHint() short-circuits to showHint() once hintUsed is true).
    const isValidHint = isHintValid(currentPuzzle && currentPuzzle.hint);

    if (isValidHint) {
        const hintRequestBtn = document.getElementById('hintRequestBtn');
        const activeHintBtn = hintRequestBtn || document.querySelector(`#step${currentStep} #hintRequestBtn`);
        if (activeHintBtn) activeHintBtn.classList.remove('hidden');
        else if (hintRequestBtn) hintRequestBtn.classList.remove('hidden');
    }

    hintDisplayed = false;
    // We do NOT reset 'currentPuzzle.hintUsed' here because that tracks SCORING (if they used it at least once).
    // Re-opening is now handled by requestHint(): the timer only runs for the first request.

    const hintContainer = document.getElementById('hintContainer');
    const overlayVisible = (hintRequestOverlay && !hintRequestOverlay.classList.contains('hidden')) ||
        (hintPenaltyOverlay && !hintPenaltyOverlay.classList.contains('hidden'));
    if (hintContainer && !overlayVisible) {
        hintContainer.classList.add('hidden');
    }
}

function cleanupHintSystem() {
    if (hintPenaltyTimer) {
        clearInterval(hintPenaltyTimer);
        hintPenaltyTimer = null;
    }

    if (hintRequestTimeout) {
        clearTimeout(hintRequestTimeout);
        hintRequestTimeout = null;
    }

    const hintRequestOverlay = document.getElementById('hintRequestOverlay');
    const hintPenaltyOverlay = document.getElementById('hintPenaltyOverlay');
    const hintDisplay = document.getElementById('hintDisplay');

    if (hintRequestOverlay) hintRequestOverlay.classList.add('hidden');
    if (hintPenaltyOverlay) hintPenaltyOverlay.classList.add('hidden');
    if (hintDisplay) hintDisplay.classList.add('hidden');

    stopHintTabMonitoring();
    hintPenaltyActive = false;
    hintRequestConfirmed = false;
    hintMalpracticePenaltyRunning = false;
}

function resetHintForNewTeam() {
    hintDisplayed = false;
    hintPenaltyActive = false;
    hintRequestConfirmed = false;
    hintTabSwitchDuringPenalty = false;
    hintMalpracticePenaltyRunning = false;
    currentPuzzleHint = null;

    if (currentPuzzle) {
        currentPuzzle.hintUsed = false;
    }

    // Reset UI elements
    const hintContainer = document.getElementById('hintContainer');
    const hintDisplay = document.getElementById('hintDisplay');
    const hintRequestBtn = document.getElementById('hintRequestBtn');
    const hintRequestOverlay = document.getElementById('hintRequestOverlay');
    const hintPenaltyOverlay = document.getElementById('hintPenaltyOverlay');

    if (hintContainer) hintContainer.classList.add('hidden');
    if (hintDisplay) hintDisplay.classList.add('hidden');
    if (hintRequestBtn) hintRequestBtn.classList.add('hidden');
    if (hintRequestOverlay) hintRequestOverlay.classList.add('hidden');
    if (hintPenaltyOverlay) hintPenaltyOverlay.classList.add('hidden');
}

// Ensure global scope access for the close button
window.closeHintPopup = closeHintPopup;
