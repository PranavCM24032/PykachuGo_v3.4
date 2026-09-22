let PUZZLES = [];
let TEAMS = [];
let MEMES = [];

// ==============================
// GAME STATE
// ==============================
let currentPuzzle = null;
let currentTeam = "";
let currentTeamTid = "";
let sessionId = "";
let loginFlowId = 0;
let urlLockedPuzzle = null;
let currentStep = 1;
let currentMissionLevel = "";
let currentLanguage = "PYTHON";
let isPuzzleActive = false;
let tabSwitchCount = 0;

// Team score and solve tracking
let currentTeamScore = 0;
let currentTeamSolvedPuzzles = new Set();
// Per-team ordered unlock queue (frontier): solving a puzzle pushes every id
// in its nextPuzzleId here; only QUEUED puzzles are unlockable (no jumping).
let teamUnlockQueue = [];

// Tab switching penalty system
let penaltyActive = false;
let penaltyTimer = null;
let penaltySeconds = 15;
let gameStartTime = null;

// 2-second grace period system
let penaltyDelayTimeout = null;
let graceCountdownInterval = null;

// Puzzle Timer System
let puzzleTimerInterval = null;

// QR Scanner State
let qrScannerActive = false;
let videoStream = null;
let flashActive = false;
let qrScanInterval = null;

// Hint System State
let hintPenaltyActive = false;
let hintPenaltySeconds = 0;
let hintPenaltyTimer = null;
let hintRequestConfirmed = false;
let hintRequestTimeout = null;
let hintTabSwitchDuringPenalty = false;
let hintTabSwitchCount = 0;
let hintMalpracticePenaltyRunning = false;
let hintDisplayed = false;
let currentPuzzleHint = null;

// Grace period variables
let blurTimeout = null;

// ==============================
// SAVE & LOAD GAME STATE
// ==============================
function saveGameState() {
    const gameState = {
        currentTeam,
        currentTeamTid,
        currentStep,
        currentPuzzleId: currentPuzzle?.id,
        tabSwitchCount,
        urlLockedPuzzleId: urlLockedPuzzle?.id,
        sessionId,
        currentLanguage
    };
    localStorage.setItem(CONFIG.STORAGE_KEYS.gameState, JSON.stringify(gameState));
}

function generateSessionId() {
    return 'SESSION_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

function getTeamStorageKey() {
    return currentTeamTid ? currentTeamTid : currentTeam;
}

function getTeamInfo() {
    try {
        return JSON.parse(localStorage.getItem(CONFIG.STORAGE_KEYS.teamInfo) || 'null');
    } catch (e) {
        return null;
    }
}

function saveTeamInfo(info) {
    try {
        localStorage.setItem(CONFIG.STORAGE_KEYS.teamInfo, JSON.stringify(info || {}));
    } catch (e) {
        console.warn('Could not save remembered trainer:', e);
    }
}

function getRememberedTeamKey() {
    const info = getTeamInfo();
    return info ? (info.tid || info.teamName || '') : '';
}

function loadTeamScoreState() {
    currentTeamScore = 0;
    currentTeamSolvedPuzzles = new Set();
    teamUnlockQueue = [];

    if (!currentTeam) return;
    try {
        const state = JSON.parse(localStorage.getItem(CONFIG.STORAGE_KEYS.scoreState) || '{}');
        const teamKey = getTeamStorageKey();
        if (teamKey && state[teamKey]) {
            currentTeamScore = state[teamKey].score || 0;
            const solvedList = Array.isArray(state[teamKey].solved) ? state[teamKey].solved : [];
            currentTeamSolvedPuzzles = new Set(solvedList);
            teamUnlockQueue = Array.isArray(state[teamKey].queue) ? state[teamKey].queue.map(Number) : [];

            // Migration: teams saved before the queue existed rebuild it from their
            // solved puzzles' outgoing edges (in solve order).
            if (!Array.isArray(state[teamKey].queue)) {
                rebuildUnlockQueue();
                saveTeamScoreState();
            }
        }
    } catch (e) {
        console.warn('Could not load team score state:', e);
    }
}

function saveTeamScoreState() {
    if (!currentTeam) return;
    try {
        const state = JSON.parse(localStorage.getItem(CONFIG.STORAGE_KEYS.scoreState) || '{}');
        const teamKey = getTeamStorageKey();
        state[teamKey] = {
            score: currentTeamScore,
            solved: Array.from(currentTeamSolvedPuzzles),
            queue: teamUnlockQueue
        };
        localStorage.setItem(CONFIG.STORAGE_KEYS.scoreState, JSON.stringify(state));
    } catch (e) {
        console.warn('Could not save team score state:', e);
    }
}

function resetTeamScoreState() {
    currentTeamScore = 0;
    currentTeamSolvedPuzzles = new Set();
    teamUnlockQueue = [];
    if (!currentTeam) return;
    try {
        const state = JSON.parse(localStorage.getItem(CONFIG.STORAGE_KEYS.scoreState) || '{}');
        const teamKey = getTeamStorageKey();
        if (teamKey && state[teamKey]) {
            delete state[teamKey];
            localStorage.setItem(CONFIG.STORAGE_KEYS.scoreState, JSON.stringify(state));
        }
    } catch (e) {
        console.warn('Could not reset team score state:', e);
    }
}

// Rebuild the unlock queue from all solved puzzles' outgoing edges.
// Used only to migrate pre-queue saves.
function rebuildUnlockQueue() {
    teamUnlockQueue = [];
    const seen = new Set(currentTeamSolvedPuzzles);
    for (const solvedId of currentTeamSolvedPuzzles) {
        const p = PUZZLES.find(x => x.id === Number(solvedId));
        if (!p) continue;
        for (const nid of (p.nextPuzzleId || []).map(Number)) {
            if (!seen.has(nid)) {
                seen.add(nid);
                teamUnlockQueue.push(nid);
            }
        }
    }
}

function hasSolvedPuzzle(puzzleId) {
    return currentTeamSolvedPuzzles.has(puzzleId);
}

// Replace the local snapshot with the state fetched for the logged-in TID. This
// keeps a device's cached state from granting progress to another user.
function applyServerTeamState(serverState) {
    if (!serverState || typeof serverState !== 'object') return;
    const solved = (Array.isArray(serverState.solved) ? serverState.solved : [])
        .map(Number).filter(n => Number.isFinite(n));
    const unlocked = (Array.isArray(serverState.unlocked) ? serverState.unlocked : [])
        .map(Number).filter(n => Number.isFinite(n));

    // Repeat-solve deductions are allowed to push the running total below zero,
    // so no lower clamp here — the signed score is restored as-is.
    currentTeamScore = Number(serverState.score || 0);
    currentTeamSolvedPuzzles = new Set(solved);
    teamUnlockQueue = unlocked.filter(id => !currentTeamSolvedPuzzles.has(id));
    saveTeamScoreState();
}

function recordPuzzleSolve(puzzleId, pointsEarned) {
    currentTeamSolvedPuzzles.add(puzzleId);
    currentTeamScore += pointsEarned;

    // Queue advance: solving a puzzle pushes its outgoing graph edges onto the
    // team's unlock queue (no duplicates, solved puzzles are excluded).
    const p = PUZZLES.find(x => x.id === Number(puzzleId));
    if (p) {
        for (const nid of (p.nextPuzzleId || []).map(Number)) {
            if (!currentTeamSolvedPuzzles.has(nid) && !teamUnlockQueue.includes(nid)) {
                teamUnlockQueue.push(nid);
            }
        }
    }

    saveTeamScoreState();
}

function standardizeString(str) {
    return (str || '').toString().replace(/\s+/g, '').toUpperCase();
}

// ==============================
// PUZZLE CHAIN GATE
// ==============================
// A puzzle is only allowed to be scanned/unlocked if it is listed in the
// NEXT puzzle chain of the player's current progress: the scanned puzzle must
// appear in currentPuzzle.nextPuzzleId. Starting puzzles (marked by startCode)
// are always allowed to begin the chain.
function isStartingPuzzle(puzzle) {
    return !!(puzzle && puzzle.startCode);
}

function getNextPuzzle(puzzle) {
    if (!puzzle) return null;
    return getNextPuzzles(puzzle)[0] || null;
}

// Graph support: nextPuzzleId is an edge list, so a puzzle can branch into
// MANY next puzzles. Returns every destination puzzle in edge order.
function getNextPuzzles(puzzle) {
    if (!puzzle) return [];
    const nextIds = (puzzle.nextPuzzleId || []).map(Number);
    return nextIds
        .map(id => PUZZLES.find(p => p.id === id))
        .filter(Boolean);
}

function isPuzzleAllowed(puzzle) {
    if (!puzzle) return false;
    if (isStartingPuzzle(puzzle)) return true;
    if (hasSolvedPuzzle(puzzle.id)) return true;
    // Queue gate: only puzzles sitting in the team's unlock queue are reachable.
    // Anything else (e.g. puzzle 3 before 2 or 6 is solved) is a jump -> blocked.
    return teamUnlockQueue.includes(Number(puzzle.id));
}

function puzzleGateMessage(puzzle) {
    const progressId = currentPuzzle ? currentPuzzle.id : 0;
    if (puzzle && puzzle.id === progressId) {
        return '❌ Access Denied - This location is already completed';
    }
    if (isStartingPuzzle(puzzle)) {
        return '❌ Access Denied - Start from the first location';
    }
    return '❌ Access Denied - Complete a connected location first';
}

async function sha256(text) {
    const data = new TextEncoder().encode(String(text));
    const buf = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}
