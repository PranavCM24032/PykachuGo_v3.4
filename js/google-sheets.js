// ==============================
// GOOGLE SHEETS INTEGRATION
// ==============================
const SESSION_BUFFER_KEY = 'pykachuSessionBuffer';

// In-memory dirty flag: avoids a localStorage read every 10s when buffer is empty.
let _bufferDirty = (() => {
    try { return JSON.parse(localStorage.getItem(SESSION_BUFFER_KEY) || '[]').length > 0; } catch { return false; }
})();

// Stable id per event so a buffered retry is recognised and ignored by the
// backend (prevents duplicate point awards when a response was lost).
function generateEventId() {
    return 'EV_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 10);
}

// The server-issued login session is the only accepted proof of team identity.
function getLoginToken() {
    if (typeof loginToken !== 'undefined' && loginToken) return loginToken;
    const info = typeof getTeamInfo === 'function' ? getTeamInfo() : null;
    return (info && info.loginToken) || '';
}

// Sliding window rate limit for Google Sheets API calls (protects Apps Script quota).
// The default minIntervalMs is windowMs/limit = 2000ms, which forced every
// outbound call after the first one to wait 2s — the login/answer buttons felt
// dead for seconds. Keep the 30-per-minute cap but let calls go out immediately.
const sheetsRateLimiter = new SlidingWindowRateLimiter({
    limit: 30,               // max requests per window
    windowMs: 60000,         // 60s rolling window
    minIntervalMs: 0,        // no artificial spacing between calls
    persistKey: 'pykachuSheetsRateLimit' // surviving reloads
});

async function waitForSheetsSlot() {
    return await sheetsRateLimiter.acquire();
}

const SHEETS_RETRY_DELAYS_MS = [500, 1500, 3500];

function isSheetsSuccess(result) {
    const json = result && result.json;
    return Boolean(result && result.ok && json && !json.rateLimited && (json.status === 'success' || json.status === 'OK'));
}

function isRetryableSheetsFailure(response, json) {
    if (json && json.status === 'rate_limited') return false;
    if (!response || !json) return true;
    if (response.status === 408 || response.status === 429 || response.status >= 500) return true;
    const message = String(json.message || '').toLowerCase();
    return /lock unavailable|simultaneous|too many scripts|service invoked too many times|quota exceeded/.test(message);
}

async function postToGoogleSheets(body, action) {
    for (let attempt = 0; attempt <= SHEETS_RETRY_DELAYS_MS.length; attempt++) {
        await waitForSheetsSlot();
        let response;
        let json = null;
        try {
            response = await fetch(GOOGLE_SCRIPT_URL, {
                method: 'POST',
                mode: 'cors',
                cache: 'no-cache',
                keepalive: true,
                headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                body: JSON.stringify({
                    ...body,
                    token: GOOGLE_SCRIPT_TOKEN,
                    loginToken: body.loginToken || getLoginToken()
                })
            });
            json = await response.json();
        } catch (error) {
            if (attempt === SHEETS_RETRY_DELAYS_MS.length) {
                console.warn(`[Sheets] Request failed for ${action}:`, error);
                return { ok: false, json: null };
            }
        }

        if (response && response.ok && isSheetsSuccess({ ok: true, json })) {
            return { ok: true, json };
        }

        if (!isRetryableSheetsFailure(response, json) || attempt === SHEETS_RETRY_DELAYS_MS.length) {
            return { ok: false, json };
        }

        await new Promise(resolve => setTimeout(
            resolve,
            SHEETS_RETRY_DELAYS_MS[attempt] + Math.floor(Math.random() * 500)
        ));
    }
    return { ok: false, json: null };
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
        _bufferDirty = true;
    } catch (e) {
        console.warn('[Buffer] Could not save to localStorage:', e);
    }
}

function clearSessionBuffer() {
    try {
        localStorage.removeItem(SESSION_BUFFER_KEY);
        _bufferDirty = false;
    } catch (e) { }
}

function isValidTeam() {
    let name = (typeof currentTeam !== 'undefined' ? currentTeam : '').trim();
    if (!name || name === 'Unknown' || name === 'NO TEAM') {
        const info = typeof getTeamInfo === 'function' ? getTeamInfo() : null;
        if (info && info.teamName) {
            currentTeam = info.teamName;
            if (info.tid && typeof currentTeamTid !== 'undefined' && !currentTeamTid) currentTeamTid = info.tid;
            if (info.mission && typeof currentMissionLevel !== 'undefined' && !currentMissionLevel) currentMissionLevel = info.mission;
            name = currentTeam;
        }
    }
    return Boolean(name && name !== 'Unknown' && name !== 'NO TEAM');
}

// ── Per-puzzle event throttling (quota guard) ──
// Spam-prone actions are sent a bounded number of times per puzzle/session.
// Every occurrence still increments a cumulative counter in the payload, so
// the sheet reflects true totals without one request per spam event.
const EVENT_THROTTLE = {
    'WRONG_ATTEMPT':     { interval: 5, countField: 'attemptCount' },
    'QR_BLOCKED':        { interval: 5, countField: 'blockedCount' },
    'PENALTY_TRIGGERED': { interval: 5 }, // already carries cumulative tabSwitches
    'HINT_USED':         { once: true }   // one live flag per puzzle; re-reveals resend safely (sheet is idempotent)
};
const _throttleCounts = {};

function shouldSendThrottled(action, puzzleId) {
    const rule = EVENT_THROTTLE[action];
    if (!rule) return { send: true, count: 1 };
    const key = `${currentTeam || ''}:${action}:${puzzleId || 0}`;
    const n = (_throttleCounts[key] = (_throttleCounts[key] || 0) + 1);
    if (rule.once) return { send: n === 1, count: n };
    if (n === 1 || n % rule.interval === 0) return { send: true, count: n };
    return { send: false, count: n };
}

async function submitToGoogleSheets(action, data = {}) {
    try {
        // Skip entirely if no valid team (anonymous sessions)
        if (!isValidTeam()) {
            console.log('[Sheets] Skipping — no valid team set');
            return false;
        }

        const payload = {
            action: action,
            sessionId: sessionId,
            teamName: currentTeam || 'Unknown',
            tid: currentTeamTid || '',
            mission: typeof currentMissionLevel !== 'undefined' ? currentMissionLevel : '',
            puzzleId: data.puzzleId || currentPuzzle?.id || 0,
            puzzleLevel: data.puzzleLevel || currentPuzzle?.level,
            timestamp: new Date().toISOString(),
            loginToken: getLoginToken(),
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
            return false;
        }

        // Send immediately in real-time; buffer ONLY if the send fails so the
        // 10s flush / unload retry never duplicates events that already reached the sheet.
        const sent = await sendToGoogleSheets(payload);
        if (!sent) {
            addToSessionBuffer(payload);
            console.log(`[Sheets] Buffered ${action} for retry`);
        }
        return sent;

    } catch (error) {
        console.error('CRITICAL: Error submitting telemetry:', error);
        return false;
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
        const result = await postToGoogleSheets(payload, payload.action);
        if (isSheetsSuccess(result)) {
            console.log(`[Sheets] Confirmed written: ${payload.action}`);
            return true;
        }
        console.warn(`[Sheets] Script did not confirm ${payload.action}:`, (result && result.json && result.json.message) || result);
        return false;
    } catch (error) {
        console.warn(`[Sheets] Send failed for ${payload.action}:`, error);
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

    // Chunk to max 10 events per batch to avoid holding the backend lock too long
    const batch = buffer.slice(0, 10);
    const remaining = buffer.slice(10);

    try {
        const result = await postToGoogleSheets({
            action: 'SESSION_BATCH',
            events: batch,
            sessionId: sessionId,
            teamName: currentTeam,
            tid: currentTeamTid
        }, 'SESSION_BATCH');
        if (isSheetsSuccess(result)) {
            console.log(`[Sheets] Flushed ${batch.length} buffered events`);
            if (remaining.length > 0) {
                try {
                    localStorage.setItem(SESSION_BUFFER_KEY, JSON.stringify(remaining));
                    _bufferDirty = true;
                } catch (e) { }
            } else {
                clearSessionBuffer();
            }
        } else {
            console.warn('[Sheets] Flush rejected by server, keeping buffer for retry:', (result && result.json && result.json.message) || result);
        }
    } catch (error) {
        console.warn('[Sheets] Flush failed, will retry later:', error);
    }
}

// Exchange a team key for a short-lived server login session. The token is
// the only thing the backend will accept as proof of team identity.
async function loginTeam(teamName, tid, securityKey) {
    if (!GOOGLE_SCRIPT_URL || !GOOGLE_SCRIPT_TOKEN || GOOGLE_SCRIPT_URL.includes("SCRIPT_URL_HERE")) {
        return { ok: false, json: { status: 'configuration_error' } };
    }
    try {
        const result = await postToGoogleSheets({
            action: 'LOGIN',
            teamName: teamName || '',
            tid: tid || '',
            securityKey: securityKey || ''
        }, 'LOGIN');
        if (isSheetsSuccess(result) && result.json && result.json.loginToken) {
            return { ok: true, ...result.json };
        }
        return { ok: false, json: (result && result.json) || { status: 'network_error' } };
    } catch (error) {
        console.warn('[Sheets] Login failed:', error);
        return { ok: false, json: { status: 'network_error' } };
    }
}

// Reconcile a locally-validated answer with the server's stored score.
async function submitAnswerToServer(puzzleId, answer, extra = {}) {
    if (!GOOGLE_SCRIPT_URL || GOOGLE_SCRIPT_URL.includes("SCRIPT_URL_HERE")) {
        return { ok: false, json: null };
    }
    try {
        const payload = {
            action: 'SUBMIT_ANSWER',
            puzzleId: Number(puzzleId) || 0,
            answer: String(answer == null ? '' : answer),
            ...extra
        };
        if (!payload.eventId) payload.eventId = generateEventId();
        const result = await postToGoogleSheets(payload, 'SUBMIT_ANSWER');
        if (isSheetsSuccess(result) && result.json) return { ok: true, ...result.json };
        return { ok: false, json: (result && result.json) || null };
    } catch (error) {
        console.warn('[Sheets] Answer submit failed:', error);
        return { ok: false, json: null };
    }
}

// Validate a start code without shipping the code list to the browser.
async function verifyStartCode(startCode, puzzleId = 0) {
    if (!GOOGLE_SCRIPT_URL || GOOGLE_SCRIPT_URL.includes("SCRIPT_URL_HERE")) {
        return { ok: false, json: null };
    }
    try {
        const result = await postToGoogleSheets({
            action: 'SUBMIT_START_CODE',
            startCode: String(startCode || ''),
            puzzleId: Number(puzzleId) || 0
        }, 'SUBMIT_START_CODE');
        if (isSheetsSuccess(result) && result.json) return { ok: true, ...result.json };
        return { ok: false, json: (result && result.json) || null };
    } catch (error) {
        console.warn('[Sheets] Start code check failed:', error);
        return { ok: false, json: null };
    }
}

// Pull the logged-in team's stored frontier (solved/unlocked ids + score).
async function fetchTeamState() {
    if (!GOOGLE_SCRIPT_URL || GOOGLE_SCRIPT_URL.includes("SCRIPT_URL_HERE")) return null;
    try {
        const result = await postToGoogleSheets({ action: 'GET_TEAM_STATE' }, 'GET_TEAM_STATE');
        if (result && result.ok && result.json && result.json.status === 'success') return result.json;
        console.warn('[Sheets] Could not fetch team state:', (result && result.json && result.json.message) || result);
        return null;
    } catch (error) {
        console.warn('[Sheets] Could not fetch team state:', error);
        return null;
    }
}

// Auto-flush buffer with randomized jitter (8s - 14s) to avoid thundering-herd pulses
function scheduleNextBufferFlush() {
    const delay = 8000 + Math.floor(Math.random() * 6000);
    setTimeout(() => {
        if (_bufferDirty && isValidTeam()) {
            flushSessionBuffer().finally(scheduleNextBufferFlush);
        } else {
            scheduleNextBufferFlush();
        }
    }, delay);
}
scheduleNextBufferFlush();

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
                    body: JSON.stringify({
                        action: 'SESSION_BATCH',
                        events: buffer,
                        sessionId: sessionId,
                        teamName: currentTeam,
                        tid: currentTeamTid,
                        token: GOOGLE_SCRIPT_TOKEN,
                        loginToken: getLoginToken()
                    })
                })
                    .then(r => r.json())
                    .then(json => {
                        if (json && !json.rateLimited && (json.status === 'success' || json.status === 'OK')) clearSessionBuffer();
                    })
                    .catch(() => { });
            } else {
                // Keep the buffer so the next session's 10s flush retries it
                console.log('[Sheets] Unload flush skipped — rate limit reached');
            }
        }
    }
});