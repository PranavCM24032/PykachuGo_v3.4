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

// Notebooks are keyed by team so a shared device can never leak one team's
// half-solved notes into another team's session.
function getNotebookStorageKey() {
    const teamKey = (typeof getTeamStorageKey === 'function')
        ? getTeamStorageKey()
        : ((typeof currentTeamTid !== 'undefined' && currentTeamTid) || (typeof currentTeam !== 'undefined' ? currentTeam : ''));
    return CONFIG.STORAGE_KEYS.puzzleNotebook + (teamKey ? ':' + teamKey : '');
}

function refreshNotebookDirty() {
    try {
        const notebook = JSON.parse(localStorage.getItem(getNotebookStorageKey()) || '{}');
        _notebookDirty = Object.keys(notebook).some(pid => notebook[pid] && notebook[pid].dirty && !notebook[pid].solvedAt);
    } catch (e) {
        _notebookDirty = false;
    }
    return _notebookDirty;
}

// Called after login/logout so the in-memory mirror never spans two teams.
function resetNotebookMirror() {
    _notebookMirror = null;
    refreshNotebookDirty();
}

function getPuzzleNotebook() {
    _notebookMirror = _notebookMirror || (() => {
        try {
            const nb = JSON.parse(localStorage.getItem(getNotebookStorageKey()) || '{}');
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
        localStorage.setItem(getNotebookStorageKey(), JSON.stringify(notebook));
    } catch (e) {
        console.warn('[Notebook] Could not save:', e);
    }
}

function deletePuzzleNotebook(puzzleId) {
    const notebook = getPuzzleNotebook();
    delete notebook[puzzleId];
    savePuzzleNotebook(notebook);
    refreshNotebookDirty();
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
// An explicit puzzle can be passed when the current one has not been activated
// yet (e.g. a scan of the next location).
function notepadStart(puzzle) {
    const target = puzzle || (typeof currentPuzzle !== 'undefined' ? currentPuzzle : null);
    if (!target) return;
    const notebook = getPuzzleNotebook();
    const pid = target.id;
    let n = notebook[pid];
    if (!n) n = createNotepad(notebook, target);
    n.unlockedAt = n.unlockedAt || Date.now();
    n.lastActivityAt = Date.now();
    n.dirty = true;
    _notebookDirty = true;
    savePuzzleNotebook(notebook);
}

// Bump a counter locally: 'scan' | 'wrong' | 'hint' | 'tabswitch'
function notepadBump(field, puzzle) {
    const target = puzzle || (typeof currentPuzzle !== 'undefined' ? currentPuzzle : null);
    if (!target) return;
    const notebook = getPuzzleNotebook();
    const pid = target.id;
    let n = notebook[pid];
    if (!n) n = createNotepad(notebook, target);
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

    let sent = false;
    if (solved) {
        sent = await submitToGoogleSheets('SOLVED', { ...(extra || {}), ...summary });
        if (sent) delete notebook[puzzleId];
    } else {
        sent = await submitToGoogleSheets('PUZZLE_ABANDONED', { ...summary, eventId: n.pendingEventId });
        if (sent) {
            delete n.pendingEventId;
            n.dirty = false;
            n.lastActivityAt = Date.now();
        }
    }
    savePuzzleNotebook(notebook);
    refreshNotebookDirty();
    return sent;
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
        n.pendingEventId = n.pendingEventId || (typeof generateEventId === 'function' ? generateEventId() : undefined);
        savePuzzleNotebook(notebook);
        const summary = notepadSummaryOf(n);
        const payload = {
            action: 'PUZZLE_ABANDONED',
            sessionId: sessionId,
            teamName: currentTeam,
            tid: currentTeamTid,
            mission: currentMissionLevel || '',
            timestamp: new Date().toISOString(),
            eventId: n.pendingEventId,
            ...summary
        };
        const body = JSON.stringify({
            ...payload,
            token: GOOGLE_SCRIPT_TOKEN,
            loginToken: (typeof getLoginToken === 'function') ? getLoginToken() : ''
        });
        let queued = false;

        if (typeof navigator.sendBeacon === 'function') {
            try {
                queued = navigator.sendBeacon(
                    GOOGLE_SCRIPT_URL,
                    new Blob([body], { type: 'text/plain;charset=utf-8' })
                );
            } catch (e) { }
        }

        if (queued) {
            console.log('[Notebook] Abandonment queued; retaining it locally until a later confirmation.');
        } else {
            fetch(GOOGLE_SCRIPT_URL, {
                method: 'POST',
                mode: 'cors',
                cache: 'no-cache',
                keepalive: true,
                headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                body: body
            })
                .then(async response => {
                    if (!response.ok) throw new Error(`HTTP ${response.status}`);
                    const json = await response.json();
                    if (json && !json.rateLimited && (json.status === 'success' || json.status === 'OK')) {
                        n.dirty = false;
                        delete n.pendingEventId;
                        savePuzzleNotebook(notebook);
                    } else {
                        console.warn('[Notebook] Unload save was not confirmed:', (json && json.message) || json);
                    }
                })
                .catch(error => console.warn('[Notebook] Unload save failed; retaining it for retry:', error));
        }

        n.dirty = true;
        _notebookDirty = true;
        savePuzzleNotebook(notebook);
    }
}