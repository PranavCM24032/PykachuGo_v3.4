// ==============================
// GOOGLE SHEETS INTEGRATION
// ==============================
const SESSION_BUFFER_KEY = 'pykachuSessionBuffer';

// Stable id per event so a buffered retry is recognised and ignored by the
// backend (prevents duplicate point awards when a response was lost).
function generateEventId() {
    return 'EV_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 10);
}

// Sliding window rate limit for Google Sheets API calls (protects Apps Script quota).
const sheetsRateLimiter = new SlidingWindowRateLimiter({
    limit: 30,               // max requests per window
    windowMs: 60000,         // 60s rolling window
    persistKey: 'pykachuSheetsRateLimit' // surviving reloads
});

async function waitForSheetsSlot() {
    return await sheetsRateLimiter.acquire();
}

function getSessionBuffer() {
    try {
        return JSON.parse(localStorage.getItem(SESSION_BUFFER_KEY) || '[]');
    } catch (e) {
        return [];
    }
}

function addToSessionBuffer(payload) {
    const buffer = getSessionBuffer();
    buffer.push(payload);
    try {
        localStorage.setItem(SESSION_BUFFER_KEY, JSON.stringify(buffer));
    } catch (e) {
        console.warn('[Buffer] Could not save to localStorage:', e);
    }
}

function clearSessionBuffer() {
    try {
        localStorage.removeItem(SESSION_BUFFER_KEY);
    } catch (e) { }
}

function isValidTeam() {
    const name = (typeof currentTeam !== 'undefined' ? currentTeam : '').trim();
    return name && name !== 'Unknown' && name !== 'NO TEAM' && name !== '';
}

// ── Per-puzzle event throttling (quota guard) ──
// Spam-prone actions are sent a bounded number of times per puzzle/session.
// Every occurrence still increments a cumulative counter in the payload, so
// the sheet reflects true totals without one request per spam event.
const EVENT_THROTTLE = {
    'WRONG_ATTEMPT':     { interval: 5, countField: 'attemptCount' },
    'QR_BLOCKED':        { interval: 5, countField: 'blockedCount' },
    'PENALTY_TRIGGERED': { interval: 5 } // already carries cumulative tabSwitches
};
const _throttleCounts = {};

function shouldSendThrottled(action, puzzleId) {
    const rule = EVENT_THROTTLE[action];
    if (!rule) return { send: true, count: 1 };
    const key = `${action}:${puzzleId || 0}`;
    const n = (_throttleCounts[key] = (_throttleCounts[key] || 0) + 1);
    if (rule.once) return { send: n === 1, count: n };
    if (n === 1 || n % rule.interval === 0) return { send: true, count: n };
    return { send: false, count: n };
}

async function submitToGoogleSheets(action, data = {}) {
    try {
        const payload = {
            action: action,
            sessionId: sessionId,
            teamName: currentTeam || 'Unknown',
            tid: currentTeamTid || '',
            mission: typeof currentMissionLevel !== 'undefined' ? currentMissionLevel : '',
            puzzleId: currentPuzzle?.id || 0,
            puzzleLevel: currentPuzzle?.level,
            timestamp: new Date().toISOString(),
            ...data
        };
        // One id per logical event; preserved across buffer retries.
        if (!payload.eventId) payload.eventId = generateEventId();
        if (action === 'REGISTRATION') {
            payload.language = currentLanguage || 'PYTHON';
        }

        if (action.includes('HINT')) {
            payload.hintType = 'DECRYPTION_BASED';
            payload.hintPenaltyTime = currentPuzzle?.hintPenalty || 60;
            payload.hintDisplayed = typeof hintDisplayed !== 'undefined' ? hintDisplayed : false;
        }

        // Drop spam events over the per-puzzle budget (counts still accumulate).
        const throttle = shouldSendThrottled(action, payload.puzzleId);
        if (throttle.countField) payload[throttle.countField] = throttle.count;
        if (!throttle.send) {
            console.log(`[Sheets] Throttled ${action} (${throttle.count}th occurrence)`);
            return;
        }

        // Skip entirely if no valid team (anonymous sessions)
        if (!isValidTeam()) {
            console.log('[Sheets] Skipping — no valid team set');
            return;
        }

        // Send immediately in real-time; buffer ONLY if the send fails so the
        // 10s flush / unload retry never duplicates events that already reached the sheet.
        const sent = await sendToGoogleSheets(payload);
        if (!sent) {
            addToSessionBuffer(payload);
            console.log(`[Sheets] Buffered ${action} for retry`);
        }

    } catch (error) {
        console.error('CRITICAL: Error submitting telemetry:', error);
    }
}

async function sendToGoogleSheets(payload) {
    const team = (payload.teamName || '').trim();
    if (!team || team === 'Unknown' || team === 'NO TEAM') {
        console.log('[Sheets] Blocked — invalid team:', team);
        return false;
    }
    if (!GOOGLE_SCRIPT_URL || GOOGLE_SCRIPT_URL.includes("SCRIPT_URL_HERE")) {
        console.warn("[Sheets] URL missing. Cannot send.");
        return false;
    }
    try {
        // Throttle to a max of N requests per sliding window
        await waitForSheetsSlot();
        const res = await fetch(GOOGLE_SCRIPT_URL, {
            method: 'POST',
            mode: 'cors',
            cache: 'no-cache',
            keepalive: true,
            headers: { 'Content-Type': 'text/plain;charset=utf-8' },
            body: JSON.stringify({ ...payload, token: GOOGLE_SCRIPT_TOKEN })
        });
        if (!res.ok) {
            console.warn(`[Sheets] HTTP error ${res.status} for ${payload.action}`);
            return false;
        }
        const json = await res.json();
        if (json.status === 'success' || json.status === 'OK') {
            console.log(`[Sheets] Confirmed written: ${payload.action}`);
            return true;
        }
        console.warn(`[Sheets] Script returned error for ${payload.action}:`, json.message || json);
        return false;
    } catch (e) {
        console.warn(`[Sheets] Send failed for ${payload.action}:`, e);
        return false;
    }
}

async function flushSessionBuffer() {
    const buffer = getSessionBuffer();
    if (buffer.length === 0) return;
    if (!isValidTeam()) {
        clearSessionBuffer();
        return;
    }
    if (!GOOGLE_SCRIPT_URL || GOOGLE_SCRIPT_URL.includes("SCRIPT_URL_HERE")) {
        console.warn("[Sheets] URL missing. Keeping buffer for later.");
        return;
    }

    try {
        // Throttle batch flushes through the same sliding window
        await waitForSheetsSlot();
        const res = await fetch(GOOGLE_SCRIPT_URL, {
            method: 'POST',
            mode: 'cors',
            cache: 'no-cache',
            keepalive: true,
            headers: { 'Content-Type': 'text/plain;charset=utf-8' },
            body: JSON.stringify({ action: 'SESSION_BATCH', events: buffer, sessionId: sessionId, token: GOOGLE_SCRIPT_TOKEN })
        });
        // The Apps Script always returns HTTP 200 even on failures, so clearing
        // the buffer on res.ok alone would DROP events that never reached the
        // sheet. Only clear once the script confirms success.
        const json = await res.json().catch(() => null);
        if (res.ok && json && (json.status === 'success' || json.status === 'OK')) {
            console.log(`[Sheets] Flushed ${buffer.length} buffered events`);
            clearSessionBuffer();
        } else {
            console.warn('[Sheets] Flush rejected by server, keeping buffer for retry:', (json && json.message) || res.status);
        }
    } catch (e) {
        console.warn('[Sheets] Flush failed, will retry later:', e);
    }
}

// Pull a team's stored frontier (solved/queue ids + score) back from Google Sheets
async function fetchTeamState(tid) {
    if (!tid) return null;
    if (!GOOGLE_SCRIPT_URL || GOOGLE_SCRIPT_URL.includes("SCRIPT_URL_HERE")) return null;
    try {
        await waitForSheetsSlot();
        const res = await fetch(GOOGLE_SCRIPT_URL, {
            method: 'POST',
            mode: 'cors',
            cache: 'no-cache',
            keepalive: true,
            headers: { 'Content-Type': 'text/plain;charset=utf-8' },
            body: JSON.stringify({ action: 'GET_TEAM_STATE', tid, token: GOOGLE_SCRIPT_TOKEN })
        });
        if (!res.ok) return null;
        const json = await res.json();
        if (json.status !== 'success') return null;
        return json;
    } catch (e) {
        console.warn('[Sheets] Could not fetch team state:', e);
        return null;
    }
}

// Auto-flush buffer every 10 seconds for extra reliability
setInterval(() => {
    if (isValidTeam()) {
        flushSessionBuffer();
    }
}, 10000);

// Auto-flush on page unload (sends whatever is buffered)
window.addEventListener('beforeunload', () => {
    if (isValidTeam()) {
        // Send any half-done puzzle notebook first (rate-limit-safe)
        if (typeof flushPuzzleNotebooksOnUnload === 'function') {
            flushPuzzleNotebooksOnUnload();
        }
        const buffer = getSessionBuffer();
        if (buffer.length > 0) {
            // Non-blocking slot check — never hold up page unload
            if (sheetsRateLimiter.tryAcquire() !== null) {
                fetch(GOOGLE_SCRIPT_URL, {
                    method: 'POST',
                    mode: 'cors',
                    cache: 'no-cache',
                    keepalive: true,
                    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                    body: JSON.stringify({ action: 'SESSION_BATCH', events: buffer, sessionId: sessionId, token: GOOGLE_SCRIPT_TOKEN })
                })
                    .then(r => r.json())
                    .then(json => {
                        if (json && (json.status === 'success' || json.status === 'OK')) clearSessionBuffer();
                    })
                    .catch(() => { });
            } else {
                // Keep the buffer so the next session's 10s flush retries it
                console.log('[Sheets] Unload flush skipped — rate limit reached');
            }
        }
    }
});