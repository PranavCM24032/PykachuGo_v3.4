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
    const n = notebook[puzzleId];
    if (!n) return false;

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
    if (typeof currentTeam !== 'undefined' && currentTeam) {
        flushDirtyPuzzleNotebooks();
    }
}, 20000);

// Unload-safe flush: never blocks closing the tab. If the rate limit is
// reached, the notebook stays dirty and the next load's watchdog retries.
function flushPuzzleNotebooksOnUnload() {
    if (typeof isValidTeam === 'function' && !isValidTeam()) return;
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
        fetch(GOOGLE_SCRIPT_URL, {
            method: 'POST',
            mode: 'cors',
            cache: 'no-cache',
            keepalive: true,
            headers: { 'Content-Type': 'text/plain;charset=utf-8' },
            body: JSON.stringify({ ...payload, token: GOOGLE_SCRIPT_TOKEN })
        }).catch(() => { });
        n.dirty = false;
        savePuzzleNotebook(notebook);
    }
}