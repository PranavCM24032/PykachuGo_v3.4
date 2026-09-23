// ==============================
// PER-PUZZLE NOTEBOOK (one request per puzzle)
// ==============================
// Every sub-event while solving a puzzle (scan, wrong attempts, hints,
// tab switches) is collected HERE in a small notepad — zero requests.
// When the puzzle is solved the whole notepad ships as ONE SOLVED request.
// Puzzles left open (scanned / half-solved then closed) are flushed as a
// single PUZZLE_ABANDONED summary after 60s idle, and the notepad lives in
// localStorage so leaving the page mid-puzzle never loses the progress.
// ==============================

// Mutable in-memory mirror of the notebook so every mutation targets the same
// object that gets persisted (fresh parses are read-only snapshots).
let _notebookMirror = null;
// Skip the 20s flush iteration when nothing has changed since the last check.
let _notebookDirty = false;

function getPuzzleNotebook() {
    _notebookMirror = _notebookMirror || (() => {
        try {
            const nb = JSON.parse(localStorage.getItem(CONFIG.STORAGE_KEYS.puzzleNotebook) || '{}');
            return nb;
        } catch (e) {
            return {};
        }
    })();
    return _notebookMirror;
}

function savePuzzleNotebook(notebook) {
    _notebookMirror = notebook;
    try {
        localStorage.setItem(CONFIG.STORAGE_KEYS.puzzleNotebook, JSON.stringify(notebook));
    } catch (e) {
        console.warn('[Notebook] Could not save:', e);
    }
}

function createNotepad(notebook, puzzle) {
    notebook[puzzle.id] = {
        puzzleId: puzzle.id,
        linkid: puzzle.linkid,
        level: puzzle.level,
        startedAt: Date.now(),
        unlockedAt: null,
        scanCount: 0,
        wrongAttempts: 0,
        hintsUsed: 0,
        tabSwitches: 0,
        solvedAt: null,
        dirty: false,
        lastActivityAt: Date.now()
    };
    return notebook[puzzle.id];
}

function currentNotepad() {
    if (!currentPuzzle) return null;
    const notebook = getPuzzleNotebook();
    if (!notebook[currentPuzzle.id]) {
        createNotepad(notebook, currentPuzzle);
        savePuzzleNotebook(notebook);
    }
    return notebook[currentPuzzle.id];
}

// Puzzle unlocked (via start-key, QR scan or deep link) — start the notepad.
function notepadStart() {
    const notebook = getPuzzleNotebook();
    const pid = currentPuzzle ? currentPuzzle.id : null;
    if (pid === null) return;
    let n = notebook[pid];
    if (!n) n = createNotepad(notebook, currentPuzzle);
    n.unlockedAt = n.unlockedAt || Date.now();
    n.lastActivityAt = Date.now();
    n.dirty = true;
    _notebookDirty = true;
    savePuzzleNotebook(notebook);
}

// Bump a counter locally: 'scan' | 'wrong' | 'hint' | 'tabswitch'
function notepadBump(field) {
    const notebook = getPuzzleNotebook();
    const pid = currentPuzzle ? currentPuzzle.id : null;
    if (pid === null) return;
    let n = notebook[pid];
    if (!n) n = createNotepad(notebook, currentPuzzle);
    if (field === 'scan') n.scanCount += 1;
    else if (field === 'wrong') n.wrongAttempts += 1;
    else if (field === 'hint') n.hintsUsed += 1;
    else if (field === 'tabswitch') n.tabSwitches += 1;
    n.lastActivityAt = Date.now();
    n.dirty = true;
    _notebookDirty = true;
    savePuzzleNotebook(notebook);
}

function notepadSummaryOf(n) {
    if (!n) return null;
    return {
        puzzleId: n.puzzleId,
        linkid: n.linkid,
        puzzleLevel: n.level,
        wrongAttempts: n.wrongAttempts,
        tabSwitches: n.tabSwitches,
        hintsUsed: n.hintsUsed,
        hintUsed: n.hintsUsed > 0,
        scanCount: n.scanCount,
        startedAt: n.startedAt,
        unlockedAt: n.unlockedAt,
        solvedAt: n.solvedAt
    };
}

function notepadSummary(puzzleId) {
    return notepadSummaryOf(getPuzzleNotebook()[puzzleId]);
}

// One request carrying the whole puzzle's notepad.
async function flushPuzzleNotebook(puzzleId, solved, extra) {
    const notebook = getPuzzleNotebook();
    let n = notebook[puzzleId];
    if (!n) {
        const fallbackPuzzle = (typeof currentPuzzle !== 'undefined' && currentPuzzle && currentPuzzle.id === puzzleId)
            ? currentPuzzle
            : (typeof PUZZLES !== 'undefined' ? PUZZLES.find(p => p.id === puzzleId) : null);
        n = createNotepad(notebook, fallbackPuzzle || { id: puzzleId, level: typeof currentMissionLevel !== 'undefined' ? currentMissionLevel : 1 });
    }

    if (solved) n.solvedAt = Date.now();
    const summary = notepadSummaryOf(n);

    if (solved) {
        await submitToGoogleSheets('SOLVED', { ...(extra || {}), ...summary });
        delete notebook[puzzleId];
    } else {
        await submitToGoogleSheets('PUZZLE_ABANDONED', summary);
        n.dirty = false;
        n.lastActivityAt = Date.now();
    }
    savePuzzleNotebook(notebook);
    return true;
}

// Watchdog: puzzles left open get their half-done notepad flushed once
// after 60s of inactivity so progress is never stuck under the sheet.
function flushDirtyPuzzleNotebooks() {
    const notebook = getPuzzleNotebook();
    let flushed = false;
    for (const pid of Object.keys(notebook)) {
        const n = notebook[pid];
        if (!n || !n.dirty || n.solvedAt) continue;
        const idle = Date.now() - (n.lastActivityAt || 0);
        if (idle >= 60000) {
            flushPuzzleNotebook(Number(pid), false);
            flushed = true;
        }
    }
    return flushed;
}

setInterval(() => {
    if (_notebookDirty && typeof currentTeam !== 'undefined' && currentTeam) {
        flushDirtyPuzzleNotebooks();
    }
}, 20000);

// Unload-safe flush: never blocks closing the tab. If the rate limit is
// reached, the notebook stays dirty and the next load's watchdog retries.
function flushPuzzleNotebooksOnUnload() {
    if (typeof isValidTeam === 'function' && !isValidTeam()) return;

    // Leaving while a puzzle is ACTIVE on step 3 is the same cheat signal as
    // a tab switch (the loser can no longer log out / close to clear the tally).
    // Bumped here so logout (shared path) AND page-close both count it, and so
    // the count is included in the PUZZLE_ABANDONED payload built below.
    if (typeof isPuzzleActive !== 'undefined' && isPuzzleActive && currentStep === 3) {
        if (typeof tabSwitchCount !== 'undefined') tabSwitchCount++;
        notepadBump('tabswitch');
    }

    const notebook = getPuzzleNotebook();
    for (const pid of Object.keys(notebook)) {
        const n = notebook[pid];
        if (!n || !n.dirty || n.solvedAt) continue;
        if (!sheetsRateLimiter || sheetsRateLimiter.tryAcquire() === null) {
            console.log('[Notebook] Unload flush skipped — rate limit reached');
            continue;
        }
        const summary = notepadSummaryOf(n);
        const payload = {
            action: 'PUZZLE_ABANDONED',
            sessionId: sessionId,
            teamName: currentTeam,
            tid: currentTeamTid,
            mission: currentMissionLevel || '',
            timestamp: new Date().toISOString(),
            eventId: (typeof generateEventId === 'function' ? generateEventId() : undefined),
            ...summary
        };
        const body = JSON.stringify({ ...payload, token: GOOGLE_SCRIPT_TOKEN });
        let queued = false;

        if (typeof navigator.sendBeacon === 'function') {
            try {
                queued = navigator.sendBeacon(
                    GOOGLE_SCRIPT_URL,
                    new Blob([body], { type: 'text/plain;charset=utf-8' })
                );
            } catch (e) { }
        }

        if (!queued) {
            fetch(GOOGLE_SCRIPT_URL, {
                method: 'POST',
                mode: 'cors',
                cache: 'no-cache',
                keepalive: true,
                headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                body: body
            }).catch(() => { });
        }

        // Keep failed/unconfirmed unloads dirty so the next session can retry.
        if (queued) {
            n.dirty = false;
            savePuzzleNotebook(notebook);
        }
    }
}