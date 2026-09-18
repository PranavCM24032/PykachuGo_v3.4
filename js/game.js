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
    const teamInput = document.getElementById('teamName').value.trim();
    const passwordInput = document.getElementById('teamPassword').value.trim();
    const missionLevel = document.getElementById('missionLevel').value;
    const codeLanguage = document.getElementById('codeLanguage').value;

    if (!teamInput || !passwordInput) {
        showFeedback('registrationFeedback', 'Team name and password are required!', 'error');
        return;
    }

    if (teamInput.length > 50 || passwordInput.length > 50) {
        showFeedback('registrationFeedback', 'Max 50 characters!', 'error');
        return;
    }

    // Verify team and password
    const foundTeam = TEAMS.find(t => t.team.toLowerCase() === teamInput.toLowerCase());

    if (!foundTeam) {
        showFeedback('registrationFeedback', 'Trainer not found in database!', 'error');
        triggerShake('teamName');
        playSound('error');
        return;
    }

    if (foundTeam.passwordHash !== passwordInput) {
        showFeedback('registrationFeedback', 'Incorrect security key!', 'error');
        triggerShake('teamPassword');
        playSound('error');
        return;
    }

    currentTeam = foundTeam.team;
    currentTeamTid = foundTeam.tid || '';
    currentMissionLevel = missionLevel;
    currentLanguage = codeLanguage;
    resetHintForNewTeam();
    loadTeamScoreState();
    gameStartTime = new Date();

    if (!sessionId) {
        sessionId = generateSessionId();
    }

    localStorage.setItem(CONFIG.STORAGE_KEYS.teamInfo, JSON.stringify({
        name: currentTeam,
        tid: currentTeamTid,
        missionLevel,
        language: currentLanguage,
        registeredAt: gameStartTime.toISOString(),
        sessionId: sessionId,
        currentPuzzle: 0
    }));

    submitToGoogleSheets('REGISTRATION', {
        teamName: currentTeam,
        tid: currentTeamTid,
        mission: missionLevel,
        language: currentLanguage,
        password: passwordInput,
        level: missionLevel.replace(/\D/g, '')
    });

    updateTeamStatus();
    playSound('powerUp');
    document.getElementById('screen')?.classList.add('premium-glow');
    showFeedback('registrationFeedback', `✓ Welcome back, ${currentTeam}`, 'success');

    setTimeout(() => {
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
        } else {
            showStep(2);
        }
    }, 500);
});

// ==============================
// STEP 3: UNLOCK VERIFICATION
// ==============================
document.getElementById('unlockForm').addEventListener('submit', function (e) {
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

    // A code is only ever asked for starting puzzles (those with a startCode).
    // All other puzzles unlock directly once their QR is scanned / deep-linked.
    let puzzle = null;

    if (urlLockedPuzzle) {
        if (isStartingPuzzle(urlLockedPuzzle)) {
            // Starting puzzle - require the startCode
            if (standardizeString(urlLockedPuzzle.startCode) === code) {
                puzzle = urlLockedPuzzle;
            }
        } else if (isPuzzleAllowed(urlLockedPuzzle)) {
            // Non-start puzzle reached via the unlock screen — no code needed
            puzzle = urlLockedPuzzle;
        }
    } else {
        // No URL lock - only a starting puzzle's startCode makes sense here
        puzzle = PUZZLES.find(p => isStartingPuzzle(p) && standardizeString(p.startCode) === code);
    }

    if (puzzle) {
        activatePuzzle(puzzle, 'START');
        showStep(3);
        playSound('success');
    } else {
        submitToGoogleSheets('UNLOCK_FAILED', {
            wrongCode: code,
            attemptedFor: urlLockedPuzzle ? urlLockedPuzzle.id : 'unknown',
            puzzleLevel: urlLockedPuzzle ? urlLockedPuzzle.level : undefined,
            attemptedLink: urlLockedPuzzle ? urlLockedPuzzle.linkid : 'unknown'
        });
        showFeedback('unlockFeedback', 'Incorrect key', 'error');
        triggerShake('unlockCode');
        playSound('error');
    }
});

// ==============================
// PUZZLE ACTIVATION
// (shared by the start-code unlock form and direct QR/deep-link unlocks)
// ==============================
function activatePuzzle(puzzle, unlockedVia) {
    currentPuzzle = puzzle;
    gameStartTime = new Date(); // Reset timer for the specific puzzle

    const questionEl = document.getElementById('puzzleQuestion');
    if (questionEl) questionEl.textContent = getPuzzleQuestion(puzzle);

    // Safely update clue text (might be in Step 5 or 4)
    const clueEl = document.getElementById('locationClue') || document.getElementById('locationClueText');
    if (clueEl) clueEl.textContent = puzzle.locationClue;

    // Show CSS Pokeball (Mystery State)
    const pokeball = document.getElementById('step4Pokeball');
    if (pokeball) {
        pokeball.classList.remove('hidden');
    }

    // Start the per-puzzle notebook (one request is made only on solve/abandon)
    notepadStart();
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
                <p class="font-pixel text-white leading-tight break-words mt-0.5 text-xs sm:text-sm">${(puzzle.locationClue || 'NO SIGNAL SOURCE').toUpperCase()}</p>
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
function submitPuzzleAnswer() {
    const answerInput = document.getElementById('puzzleAnswer');
    if (!answerInput) return;

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

    if (standardizeString(currentPuzzle.answer) === standardizeString(answer)) {
        playSound('victory');
        showToast("SIGNAL DECRYPTED!", "success");

        // Visual flair
        document.getElementById('screen')?.classList.add('premium-glow');
        setTimeout(() => document.getElementById('screen')?.classList.remove('premium-glow'), 2000);

        // Prepare Success Step Data
        const caughtImg = document.getElementById('capturePokemonImg') || document.getElementById('caughtPokemonImg');
        if (caughtImg && currentPuzzle.pokemonId) {
            caughtImg.src = `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/${currentPuzzle.pokemonId}.png`;
        }

        const locationCard = document.getElementById('locationCard');
        const nextBtn = document.getElementById('nextSignalBtn');

        // Show ALL next puzzle locations (graph: nextPuzzleId may branch into many)
        const nextPuzzles = getNextPuzzles(currentPuzzle);

        // Delay move for satisfaction
        const isEnd = !Array.isArray(currentPuzzle.nextPuzzleId) || currentPuzzle.nextPuzzleId.length === 0;
        setTimeout(() => {
            showStep(4);
            playSound('hologram');

            if (isEnd) {
                const locationCard = document.getElementById('locationCard');
                const nextBtn = document.getElementById('nextSignalBtn');
                if (locationCard) locationCard.classList.add('hidden');
                if (nextBtn) nextBtn.classList.add('hidden');

                const completionMessage = document.getElementById('completionMessage');
                if (completionMessage) {
                    completionMessage.classList.remove('hidden');

                    const levelNum = (currentMissionLevel || "L1").split('_')[0].replace('L', '');
                    const levelTitle = document.getElementById('completionLevelTitle');
                    if (levelTitle) levelTitle.textContent = `LEVEL ${levelNum} CHAMPION`;

                    const levelSub = document.getElementById('completionLevelSub');
                    if (levelSub) levelSub.textContent = `YOU HAVE COMPLETED LEVEL ${levelNum}`;

                    const trophyImg = document.getElementById('completionTrophyImg');
                    if (trophyImg) trophyImg.src = 'assets/img/poketropy.png';
                }

                setTimeout(() => flushSessionBuffer(), 100);
                setTimeout(() => triggerFinalCelebration(), 1500);
            } else {
                if (locationCard) locationCard.classList.remove('hidden');
                if (nextBtn) nextBtn.classList.remove('hidden');
                renderNextLocations(nextPuzzles);
            }

        }, 500);

        const firstSolve = !hasSolvedPuzzle(currentPuzzle.id);
        const basePoints = currentPuzzle.points || 0;
        const penaltyPoints = Math.max(1, basePoints / 4);
        const pointsEarned = firstSolve ? basePoints : -penaltyPoints;
        recordPuzzleSolve(currentPuzzle.id, pointsEarned);

        // ONE request per puzzle: the whole notepad (scans, wrong attempts,
        // hints, tab switches, timings) ships inside the SOLVED summary.
        flushPuzzleNotebook(currentPuzzle.id, true, {
            answer: answer,
            pointsEarned: pointsEarned,
            repeatSolve: !firstSolve,
            totalScore: currentTeamScore,
            solvedIds: Array.from(currentTeamSolvedPuzzles),
            queueIds: teamUnlockQueue,
            score: currentTeamScore
        });

        if (firstSolve) {
            showToast(`SIGNAL DECRYPTED! +${pointsEarned} pts`, 'success');
        } else {
            showToast(`REPEATED SOLVE: -${penaltyPoints} pts`, 'info');
        }

        // Flush buffered events to Google Sheets
        setTimeout(() => flushSessionBuffer(), 500);
    } else {
        playSound('error');
        showToast("DECRYPTION FAILED", "error");

        // Premium Error Effect
        document.getElementById('screen')?.classList.add('glitch-active');
        setTimeout(() => document.getElementById('screen')?.classList.remove('glitch-active'), 400);

        answerInput.value = "";
        triggerShake('puzzleAnswer');

        notepadBump('wrong');
    }
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

function togglePasswordVisibility() {
    const pwdInput = document.getElementById('teamPassword');
    const icon = document.getElementById('passwordToggleIcon');
    if (pwdInput && icon) {
        const isPassword = pwdInput.type === 'password';
        pwdInput.type = isPassword ? 'text' : 'password';
        icon.textContent = isPassword ? 'visibility' : 'visibility_off';
    }
}
window.togglePasswordVisibility = togglePasswordVisibility;
