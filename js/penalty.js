// ==============================
// 2. CONSOLIDATED SECURITY & PENALTY
// ==============================
function startTabMonitoring() {
    console.log('[Security] Monitoring active');
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('blur', handleWindowBlur);
    window.addEventListener('focus', handleWindowFocus);
}

function stopTabMonitoring() {
    document.removeEventListener('visibilitychange', handleVisibilityChange);
    window.removeEventListener('blur', handleWindowBlur);
    window.removeEventListener('focus', handleWindowFocus);
    if (blurTimeout) clearTimeout(blurTimeout);
    cancelGracePeriodUI();
}

function handleVisibilityChange() {
    if (document.hidden && isPuzzleActive && currentStep === 3) {
        triggerPenalty();
    }
}

function handleWindowBlur() {
    if (!isPuzzleActive || currentStep !== 3) return;
    if (blurTimeout) clearTimeout(blurTimeout);
    blurTimeout = setTimeout(() => {
        if (!document.hasFocus()) triggerPenalty();
    }, 1500);
}

function handleWindowFocus() {
    if (blurTimeout) {
        clearTimeout(blurTimeout);
        blurTimeout = null;
    }
}

function triggerPenalty(reason = 'TAB_SWITCH') {
    // Tab-switch penalty only applies while the code is being solved
    // (step 3 until the correct answer is submitted), NOT during the hint penalty.
    if (!isPuzzleActive || currentStep !== 3 || hintPenaltyActive) return;

    tabSwitchCount++;

    notepadBump('tabswitch');

    if (penaltyActive) {
        penaltySeconds = 15;
        const timerElement = document.getElementById('penaltyTimer');
        if (timerElement) {
            timerElement.textContent = penaltySeconds;
            timerElement.parentElement?.classList.add('animate-shake');
            setTimeout(() => timerElement.parentElement?.classList.remove('animate-shake'), 400);
        }
        resetTimerRing();
        playSound('penaltyReset');
        return;
    }

    penaltyActive = true;
    playSound('error');

    const overlay = document.getElementById('penaltyOverlay');
    if (overlay) overlay.classList.remove('hidden');

    penaltySeconds = 15;
    const timerElement = document.getElementById('penaltyTimer');
    if (timerElement) timerElement.textContent = penaltySeconds;

    resetTimerRing();

    if (penaltyTimer) clearInterval(penaltyTimer);
    penaltyTimer = setInterval(() => {
        penaltySeconds--;
        if (timerElement) timerElement.textContent = Math.max(0, penaltySeconds);
        if (penaltySeconds <= 0) clearPenalty();
    }, 1000);
}

function resetTimerRing() {
    const timerRing = document.querySelector('.penalty-timer-ring');
    if (timerRing) {
        timerRing.style.animation = 'none';
        void timerRing.offsetWidth; // Trigger reflow
        timerRing.style.animation = `countdown 15s linear forwards`;
    }
}

function showGracePeriodUI() {
    // Legacy support or placeholder for future grace systems
}

function cancelGracePeriodUI() {
    const graceOverlay = document.getElementById('gracePeriodOverlay');
    if (graceOverlay) graceOverlay.remove();
    if (graceCountdownInterval) {
        clearInterval(graceCountdownInterval);
        graceCountdownInterval = null;
    }
}


function clearPenalty() {
    console.log('Clearing penalty');
    if (penaltyTimer) {
        clearInterval(penaltyTimer);
        penaltyTimer = null;
    }

    // Clear any pending grace period timeouts
    if (penaltyDelayTimeout) {
        clearTimeout(penaltyDelayTimeout);
        penaltyDelayTimeout = null;
    }

    // Clear grace period UI
    cancelGracePeriodUI();

    penaltyActive = false;
    const overlay = document.getElementById('penaltyOverlay');
    if (overlay) overlay.classList.add('hidden');

    playSound('success');
}

// Show the 15-second MALPRACTICE penalty overlay independently.
// Used by the hint system when a tab switch happens during the hint countdown.
// Calls onComplete when the penalty timer finishes.
var _blockingPenaltyCallback = null;

function runBlockingPenalty(onComplete) {
    _blockingPenaltyCallback = typeof onComplete === 'function' ? onComplete : null;
    penaltyActive = true;

    playSound('error');

    var overlay = document.getElementById('penaltyOverlay');
    if (overlay) overlay.classList.remove('hidden');

    penaltySeconds = 15;
    var timerElement = document.getElementById('penaltyTimer');
    if (timerElement) timerElement.textContent = penaltySeconds;

    resetTimerRing();

    if (penaltyTimer) clearInterval(penaltyTimer);
    penaltyTimer = setInterval(function() {
        penaltySeconds--;
        if (timerElement) timerElement.textContent = Math.max(0, penaltySeconds);
        if (penaltySeconds <= 0) {
            clearInterval(penaltyTimer);
            penaltyTimer = null;
            penaltyActive = false;
            if (overlay) overlay.classList.add('hidden');

            notepadBump('tabswitch');

            var cb = _blockingPenaltyCallback;
            _blockingPenaltyCallback = null;
            if (cb) cb();
        }
    }, 1000);
}
