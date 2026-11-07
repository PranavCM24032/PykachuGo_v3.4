function getPuzzleQuestion(puzzle) {
    if (!puzzle) return '';
    if (currentLanguage === 'CPP') return puzzle.questionCpp || puzzle.questionPython || '';
    return puzzle.questionPython || puzzle.questionCpp || '';
}

// ==============================
// STEP 1: REGISTRATION
// ==============================
document.getElementById('registrationForm').addEventListener('submit', async function (e) {
    e.preventDefault();
    const thisLoginFlow = ++loginFlowId;
    const teamInput = document.getElementById('teamName').value.trim();
    const securityKeyInput = document.getElementById('teamSecurityKey').value.trim();
    const missionLevel = document.getElementById('missionLevel').value;
    const codeLanguage = document.getElementById('codeLanguage').value;

    if (!teamInput || !securityKeyInput) {
        showFeedback('registrationFeedback', 'Team name and security key are required!', 'error');
        return;
    }

    if (teamInput.length > 50 || securityKeyInput.length > 50) {
        showFeedback('registrationFeedback', 'Max 50 characters!', 'error');
        return;
    }

    const foundTeam = TEAMS.find(t => t.team.toLowerCase() === teamInput.toLowerCase());
    if (!foundTeam) {
        showFeedback('registrationFeedback', 'Trainer not found. Check the team name and try again.', 'error');
        triggerShake('teamName');
        playSound('error');
        return;
    }

    // Team keys live in data/teams.json, so the login is validated on-device and
    // the app opens on the same frame as the tap. The Apps Script login still
    // runs in the background to mint a telemetry session token, but the UI no
    // longer waits on that round-trip.
    const lookupTid = foundTeam.tid || '';

    if (standardizeString(securityKeyInput) !== standardizeString(foundTeam.securityKey)) {
        showFeedback('registrationFeedback', 'Invalid team name or security key!', 'error');
        triggerShake('teamSecurityKey');
        playSound('error');
        return;
    }

    const resolvedTeamName = foundTeam.team;
    const resolvedTid = lookupTid;

    const previousTeamKey = getRememberedTeamKey();
    const nextTeamKey = resolvedTid || resolvedTeamName;
    const isDifferentTeam = !previousTeamKey || previousTeamKey !== nextTeamKey;

    // A browser can be shared by multiple teams. Do not carry the previous
    // team's active puzzle, screen, or session into a new team's login.
    if (isDifferentTeam) {
        currentPuzzle = null;
        urlLockedPuzzle = null;
        currentStep = 1;
        tabSwitchCount = 0;
        sessionId = generateSessionId();
        localStorage.removeItem(CONFIG.STORAGE_KEYS.gameState);
    }

    currentTeam = resolvedTeamName;
    currentTeamTid = resolvedTid;
    currentMissionLevel = missionLevel;
    currentLanguage = codeLanguage;
    saveTeamInfo({
        teamName: currentTeam,
        tid: currentTeamTid,
        mission: missionLevel,
        language: codeLanguage
    });
    resetHintForNewTeam();
    if (typeof resetNotebookMirror === 'function') resetNotebookMirror();
    loadTeamScoreState();
    gameStartTime = new Date();

    if (!sessionId) {
        sessionId = generateSessionId();
    }

    updateTeamStatus();
    updatePowerLed();
    playSound('powerUp');
    document.getElementById('screen')?.classList.add('premium-glow');
    showFeedback('registrationFeedback', `✓ Welcome back, ${currentTeam}`, 'success');
    showStep(2);

    // Background: exchange the key for a server session, then pull the
    // authoritative snapshot. The screen is already open, so a slow or offline
    // server never blocks play.
    loginTeam(teamInput, lookupTid, securityKeyInput).then(login => {
        if (thisLoginFlow !== loginFlowId || !login.ok || !login.loginToken) return;
        loginToken = login.loginToken;

        const canonicalName = login.teamName || currentTeam;
        const canonicalTid = login.tid || currentTeamTid;
        if (canonicalName !== currentTeam || canonicalTid !== currentTeamTid) {
            currentTeam = canonicalName;
            currentTeamTid = canonicalTid;
            saveTeamInfo({
                teamName: currentTeam,
                tid: currentTeamTid,
                mission: currentMissionLevel,
                language: currentLanguage
            });
            updateTeamStatus();
        }

        submitToGoogleSheets('REGISTRATION', {
            teamName: currentTeam,
            tid: currentTeamTid,
            mission: currentMissionLevel,
            language: currentLanguage,
            level: currentMissionLevel.replace(/\D/g, '')
        });

        const versionAtLogin = progressVersion;
        return fetchTeamState().then(serverState => {
            // A slow state response must not navigate a player who has already
            // scanned a puzzle, solved it, or started another login.
            if (thisLoginFlow !== loginFlowId || currentTeamTid !== canonicalTid || currentStep !== 2) {
                return;
            }
            if (serverState) applyServerTeamState(serverState, versionAtLogin);

            document.getElementById('screen')?.classList.remove('premium-glow');
            // Universal link: skip QR scan and jump straight to that puzzle
            if (urlLockedPuzzle) {
                if (isStartingPuzzle(urlLockedPuzzle)) {
                    // Starting puzzle — ask for its start key
                    showStep('startcode');
                } else {
                    // Non-start puzzle — unlock directly, no key entry needed
                    const via = currentPuzzle ? `Puzzle ${currentPuzzle.id}` : 'DIRECT';
                    activatePuzzle(urlLockedPuzzle, via);
                    showStep(3);
                }
            } else if (!isDifferentTeam) {
                // Same team re-logging in: resume exactly where they left off
                resumeToLastStep();
            }
        });
    }).catch(() => {
        document.getElementById('screen')?.classList.remove('premium-glow');
    });
});

// ==============================
// STEP 3: UNLOCK VERIFICATION
// ==============================
document.getElementById('unlockForm').addEventListener('submit', async function (e) {
    e.preventDefault();
    const code = standardizeString(document.getElementById('unlockCode').value);

    if (!code) {
        showFeedback('unlockFeedback', 'Enter start key', 'error');
        return;
    }

    if (code.length > 50) {
        showFeedback('unlockFeedback', 'Max 50 characters!', 'error');
        return;
    }

    // Start codes live in data/puzzle.json, so match locally and unlock on the
    // same frame. The Apps Script call is now telemetry only.
    const requestedPuzzle = (urlLockedPuzzle && isStartingPuzzle(urlLockedPuzzle)) ? urlLockedPuzzle : null;
    const matched = PUZZLES.find(p => {
        if (requestedPuzzle && Number(p.id) !== Number(requestedPuzzle.id)) return false;
        return isStartingPuzzle(p) && standardizeString(p.startCode) === code;
    });

    if (matched) {
        activatePuzzle(matched, 'START');
        showStep(3);
        playSound('success');
        verifyStartCode(code, requestedPuzzle ? requestedPuzzle.id : 0).catch(() => { });
        return;
    }

    submitToGoogleSheets('UNLOCK_FAILED', {
        wrongCode: code,
        attemptedFor: urlLockedPuzzle ? urlLockedPuzzle.id : 'unknown',
        puzzleLevel: urlLockedPuzzle ? urlLockedPuzzle.level : undefined,
        attemptedLink: urlLockedPuzzle ? urlLockedPuzzle.linkid : 'unknown'
    });
    showFeedback('unlockFeedback', 'Incorrect key', 'error');
    triggerShake('unlockCode');
    playSound('error');
});

// ==============================
// PUZZLE ACTIVATION
// (shared by the start-code unlock form and direct QR/deep-link unlocks)
// ==============================
function activatePuzzle(puzzle, unlockedVia) {
    currentPuzzle = puzzle;
    gameStartTime = new Date(); // Reset timer for the specific puzzle
    unlockAnswerInput(); // new puzzle => answer field is submit-eligible again

    const questionEl = document.getElementById('puzzleQuestion');
    if (questionEl) questionEl.textContent = getPuzzleQuestion(puzzle);

    // The current puzzle's locationClue is a hunt clue ("where THIS riddle is").
    // Only write it to a dedicated current-location slot if present — NEVER into
    // step 4's next-location card, which renderNextLocations() owns (it resolves
    // the NEXT locations from nextPuzzleId).
    const clueEl = document.getElementById('locationClue');
    if (clueEl) clueEl.textContent = puzzle.locationClue;

    // Show CSS Pokeball (Mystery State)
    const pokeball = document.getElementById('step4Pokeball');
    if (pokeball) {
        pokeball.classList.remove('hidden');
    }

    // Warm the caught artwork now (and the next puzzles' too) so the step 4
    // reveal shows the sprite instantly instead of fetching a large PNG on the
    // frame the ball opens.
    if (typeof AssetPreloader !== 'undefined') {
        AssetPreloader.prioritizePokemon(puzzle.pokemonId);
        if (typeof getNextPuzzles === 'function') {
            getNextPuzzles(puzzle).forEach((p) => AssetPreloader.prioritizePokemon(p && p.pokemonId));
        }
    }

    // Start the per-puzzle notebook (one request is made only on solve/abandon)
    notepadStart(puzzle);
}

// ==============================
// STEP 5: NEXT LOCATIONS RENDER
// (graph branching — multiple next puzzles can be shown at once)
// ==============================
function createNextLocationCard(puzzle) {
    const card = document.createElement('div');
    card.className = 'bg-gray-900/80 border border-yellow-500/40 rounded-xl p-2.5 sm:p-3 relative overflow-hidden backdrop-blur-sm location-card-glow shadow-2xl mx-auto w-full max-w-xs';

    card.innerHTML = `
        <div class="absolute inset-0 map-grid-bg opacity-20"></div>
        <div class="absolute top-0 left-0 w-2.5 h-2.5 border-t-2 border-l-2 border-yellow-400/50 rounded-tl-lg"></div>
        <div class="absolute top-0 right-0 w-2.5 h-2.5 border-t-2 border-r-2 border-yellow-400/50 rounded-tr-lg"></div>
        <div class="absolute bottom-0 left-0 w-2.5 h-2.5 border-b-2 border-l-2 border-yellow-400/50 rounded-bl-lg"></div>
        <div class="absolute bottom-0 right-0 w-2.5 h-2.5 border-b-2 border-r-2 border-yellow-400/50 rounded-br-lg"></div>

        <div class="flex items-center gap-2.5 relative z-10">
            <div class="flex-shrink-0">
                <div class="w-7 h-7 sm:w-8 sm:h-8 bg-yellow-500/20 rounded-lg flex items-center justify-center border border-yellow-500/30">
                    <span class="material-symbols-rounded text-yellow-400 text-base sm:text-lg">location_on</span>
                </div>
            </div>
            <div class="flex-1 text-left min-w-0">
                <span class="text-yellow-400/80 text-[8px] sm:text-[9px] uppercase tracking-widest font-black block">NEXT
                    LOCATION</span>
                <p class="font-pixel text-white leading-tight break-words mt-0.5 text-xs sm:text-sm">${escapeHTML((puzzle.locationClue || 'NO SIGNAL SOURCE').toUpperCase())}</p>
            </div>
        </div>
    `;
    return card;
}

function renderNextLocations(nextPuzzles) {
    const list = document.getElementById('nextLocationList');
    const clueText = document.getElementById('locationClueText');
    const locationCard = document.getElementById('locationCard');

    if (!Array.isArray(nextPuzzles)) return;

    const count = nextPuzzles.length;
    if (list) list.innerHTML = '';

    if (count === 0) {
        // NOTHING: no further signals to reveal — hide all location UI.
        if (locationCard) locationCard.classList.add('hidden');
        if (clueText) clueText.classList.add('hidden');
        if (list) list.classList.add('hidden');
        return;
    }

    if (count === 1) {
        // SINGLE destination: classic single-card layout.
        if (locationCard) locationCard.classList.remove('hidden');
        if (clueText) {
            clueText.classList.remove('hidden');
            clueText.textContent = (nextPuzzles[0].locationClue || 'NO SIGNAL SOURCE');
        }
        if (list) list.classList.add('hidden');
        return;
    }

    // MULTIPLE destinations: hide the single-card paragraph and render one
    // full location card per destination (same style, no placeholder text).
    if (locationCard) locationCard.classList.add('hidden');
    if (clueText) clueText.classList.add('hidden');
    if (list) {
        list.classList.remove('hidden');
        nextPuzzles.forEach((p) => list.appendChild(createNextLocationCard(p)));
    }
}

// ==============================
// STEP 4: PUZZLE SOLVING - SUBMIT HANDLER
// ==============================
let answerLocked = false;

// The "move to step 4" timer. Stored so a logout (or a new submit) can
// cancel it instead of landing a signed-out user on the catch screen.
let revealStepTimer = null;

// True from the first correct submit until the next puzzle is activated.
// Blocks double submits that would otherwise double-deduct points.
function unlockAnswerInput() {
    answerLocked = false;
}

// Mirror the server's unlock rule from the local JSON: every start puzzle plus
// every solved puzzle and its outgoing edges.
function computeLocalUnlocked(solvedIds) {
    const allowed = new Set();
    PUZZLES.forEach(p => {
        if (isStartingPuzzle(p)) allowed.add(Number(p.id));
    });
    solvedIds.forEach(id => {
        const p = PUZZLES.find(x => Number(x.id) === Number(id));
        if (!p) return;
        allowed.add(Number(p.id));
        (p.nextPuzzleId || []).forEach(n => allowed.add(Number(n)));
    });
    return Array.from(allowed).sort((a, b) => a - b);
}

async function submitPuzzleAnswer() {
    const answerInput = document.getElementById('puzzleAnswer');
    if (!answerInput) return;

    // Re-entrancy guard. The answer field keeps its value and focus after a
    // correct solve, so a second Enter/SEND re-entered this function and
    // scored a full -points repeat, stacked a second reveal timeline and
    // shipped a duplicate SOLVED row. One submit per puzzle.
    if (answerLocked) return;

    const answer = answerInput.value.trim().toLowerCase();

    if (!answer) {
        showToast("INPUT REQUIRED", "error");
        return;
    }

    if (answer.length > 50) {
        showToast("MAX 50 CHARACTERS", "error");
        return;
    }

    if (!currentPuzzle) {
        showToast("NO PUZZLE LOADED", "error");
        return;
    }

    const puzzle = currentPuzzle;
    const summary = (typeof notepadSummary === 'function') ? (notepadSummary(puzzle.id) || {}) : {};
    const notebook = (typeof getPuzzleNotebook === 'function') ? getPuzzleNotebook() : null;
    if (notebook) {
        const entry = notebook[puzzle.id] || (typeof createNotepad === 'function' ? createNotepad(notebook, puzzle) : null);
        if (entry) {
            entry.pendingEventId = entry.pendingEventId || generateEventId();
            savePuzzleNotebook(notebook);
            summary.eventId = entry.pendingEventId;
        }
    }
    if (!summary.eventId) summary.eventId = generateEventId();

    // One submit per puzzle.
    answerLocked = true;

    // Correctness lives in data/puzzle.json, so decide on-device and update the
    // screen on the same frame. The server request below is reconciliation +
    // telemetry, not a gate.
    if (standardizeString(answerInput.value) !== standardizeString(puzzle.answer)) {
        answerLocked = false;
        playSound('error');
        showToast("DECRYPTION FAILED", "error");

        // Premium Error Effect
        document.getElementById('screen')?.classList.add('glitch-active');
        setTimeout(() => document.getElementById('screen')?.classList.remove('glitch-active'), 400);

        answerInput.value = "";
        triggerShake('puzzleAnswer');

        notepadBump('wrong', puzzle);
        setTimeout(() => flushSessionBuffer(), 250);
        return;
    }

    const repeat = hasSolvedPuzzle(puzzle.id);
    const pointsEarned = repeat ? -(puzzle.points || 0) : (puzzle.points || 0);
    const solvedIds = Array.from(currentTeamSolvedPuzzles);
    if (!repeat) solvedIds.push(Number(puzzle.id));
    const optimisticResult = {
        correct: true,
        repeat,
        points: pointsEarned,
        score: currentTeamScore + pointsEarned,
        solved: solvedIds,
        unlocked: computeLocalUnlocked(solvedIds)
    };

    // Correct — reveal immediately from the local result.
    playSound('victory');
    showToast(repeat ? `REPEATED SOLVE: ${pointsEarned} pts` : `SIGNAL DECRYPTED! +${pointsEarned} pts`, repeat ? 'info' : 'success');

    // Visual flair
    document.getElementById('screen')?.classList.add('premium-glow');
    setTimeout(() => document.getElementById('screen')?.classList.remove('premium-glow'), 2000);

    // Prepare Success Step Data
    const caughtImg = document.getElementById('capturePokemonImg') || document.getElementById('caughtPokemonImg');
    if (caughtImg && puzzle.pokemonId) {
        caughtImg.onerror = () => {
            caughtImg.onerror = null;
            caughtImg.src = 'assets/img/pikachu.png';
        };
        caughtImg.src = `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/${puzzle.pokemonId}.png`;
    }

    // Show ALL next puzzle locations (graph: nextPuzzleId may branch into many)
    const nextPuzzles = getNextPuzzles(puzzle);

    // Move immediately: the server already confirmed this solve, so making the
    // player wait on a cosmetic timer just reads as lag.
    const isEnd = !Array.isArray(puzzle.nextPuzzleId) || puzzle.nextPuzzleId.length === 0;

    // Capture the puzzle this reveal belongs to. Without this the callback
    // read the mutable global `currentPuzzle`, which logout nulls — and the
    // timer still fired, showing a signed-out user the catch screen.
    const solvedPuzzle = puzzle;

    clearTimeout(revealStepTimer);
    revealStepTimer = setTimeout(() => {
        // The user may have logged out inside this reveal window.
        if (!isLoggedIn() || currentPuzzle !== solvedPuzzle) return;

        // Arm the end-of-chain celebration BEFORE showStep(4): the reveal
        // starts inside showStep(4) and signals 'pykachu:reveal-open' at
        // the frame the ball splits open, so confetti fires in sync with the
        // reveal instead of drifting on a timer of its own.
        if (isEnd) armFinalCelebration();

        showStep(4);
        playSound('hologram');

        const nextBtn = document.getElementById('nextSignalBtn');
        if (isEnd) {
            if (nextBtn) nextBtn.classList.add('hidden');

            const completionMessage = document.getElementById('completionMessage');
            if (completionMessage) {
                completionMessage.classList.remove('hidden');

            // Prefer the solved puzzle's OWN level (puzzle.json `level`
            // field); fall back to the mission level only if missing.
            const levelNum = (solvedPuzzle && typeof solvedPuzzle.level === 'number')
                ? solvedPuzzle.level
                : ((currentMissionLevel || "L1").split('_')[0].replace('L', '') || '1');
                const levelTitle = document.getElementById('completionLevelTitle');
                if (levelTitle) levelTitle.textContent = `LEVEL ${levelNum} CHAMPION`;

                const levelSub = document.getElementById('completionLevelSub');
                if (levelSub) levelSub.textContent = `YOU HAVE COMPLETED LEVEL ${levelNum}`;

                const trophyImg = document.getElementById('completionTrophyImg');
                if (trophyImg) trophyImg.src = 'assets/img/poketropy.png';
            }

            setTimeout(() => flushSessionBuffer(), 100);
        } else {
            if (nextBtn) nextBtn.classList.remove('hidden');
        }

        // Step 4's location card ALWAYS shows the NEXT locations resolved
        // from nextPuzzleId (never the current puzzle's clue). count 0 →
        // final puzzle → hides the card entirely.
        renderNextLocations(nextPuzzles);

    }, 0);

    // Apply the local result now and drop the notebook; its summary is already
    // in the telemetry payload.
    applyAuthoritativeSolve(optimisticResult);
    if (typeof deletePuzzleNotebook === 'function') deletePuzzleNotebook(puzzle.id);

    // Reconcile against the server without blocking play. Ignore the reply if
    // the player has already made newer local progress.
    const versionAfterLocal = progressVersion;
    submitAnswerToServer(puzzle.id, answer, summary).then(result => {
        if (result && result.ok && result.correct && progressVersion === versionAfterLocal) {
            applyAuthoritativeSolve(result);
        }
    }).catch(() => { });

    // Flush buffered events to Google Sheets
    setTimeout(() => flushSessionBuffer(), 250);
}
// Attach the submit handler
document.getElementById('answerForm').addEventListener('submit', (e) => {
    e.preventDefault(); // Prevent default form submission
    submitPuzzleAnswer();
});

// ==============================
// STEP 5: CONTINUE
// ==============================
function continueToQRScan() {
    // Check if current puzzle is the final one (empty nextPuzzleId = end of chain)
    const isEnd = currentPuzzle && (!Array.isArray(currentPuzzle.nextPuzzleId) || currentPuzzle.nextPuzzleId.length === 0);
    if (isEnd) {
        showToast('🎉 CONGRATULATIONS! You have completed all puzzles!', 'success');
        playSound('victory');

        // Show completion message instead of going to QR scan
        setTimeout(() => {
            showToast('No more puzzles available. Game Complete!', 'success');
        }, 2000);

        return; // Don't proceed to QR scan
    }

    document.getElementById('unlockCode').value = '';
    urlLockedPuzzle = null;
    showStep(2);
}

// ==============================
// FINAL CELEBRATION SYNC
// ==============================
// The confetti used to fire on a blind 1500ms timer after showStep(4), so it
// regularly landed in the middle of the Pokéball falling — disconnected from
// the reveal. It is now driven by the reveal itself: playPokemonReveal()
// dispatches 'pykachu:reveal-open' on the exact frame the shells split, and
// this fires the celebration on that beat.
//
// The fallback only exists for the case where the reveal never runs at all
// (missing #pokemonReveal / #step4RevealBall markup, or the reveal being
// cancelled by a second showStep(4)). Every armed listener self-cleans, so a
// stale listener can never hijack a later reveal.
const REVEAL_OPEN_FALLBACK_MS = 2900;

function armFinalCelebration() {
    if (typeof triggerFinalCelebration !== 'function') return;

    let fired = false;
    let fallbackTimer = null;

    const fire = () => {
        if (fired) return;
        fired = true;
        clearTimeout(fallbackTimer);
        document.removeEventListener('pykachu:reveal-open', onRevealOpen);
        // Never fire confetti over a screen the player has already left.
        const step4 = document.getElementById('step4');
        const stillOnStep4 = !!step4 && step4.classList.contains('active');
        const stillSignedIn = typeof isLoggedIn !== 'function' || isLoggedIn();
        if (!stillOnStep4 || !stillSignedIn) return;
        triggerFinalCelebration();
    };
    const onRevealOpen = () => fire();

    fallbackTimer = setTimeout(fire, REVEAL_OPEN_FALLBACK_MS);
    document.addEventListener('pykachu:reveal-open', onRevealOpen);
}

function backToStep2() {
    showStep(2);
}

// ==============================
// ANTI-CHEAT PROTECTION
// ==============================
function removeBlackout() {
    // Managed by security.js
}

function showAntiCopyToast() {
    // Managed by security.js
}

function toggleSecurityKeyVisibility() {
    const keyInput = document.getElementById('teamSecurityKey');
    const icon = document.getElementById('securityKeyToggleIcon');
    if (keyInput && icon) {
        const isMasked = keyInput.type === 'password';
        keyInput.type = isMasked ? 'text' : 'password';
        icon.textContent = isMasked ? 'visibility' : 'visibility_off';
    }
}

window.toggleSecurityKeyVisibility = toggleSecurityKeyVisibility;
