// =================================================================
// PYKACHU GO - MULTI-TAB (1-ROW-PER-TEAM PER SHEET) BACKEND
// =================================================================
// 4 Tabs in 1 Workbook: Registration, L1, L2, L3
// Each team gets ONLY 1 ROW per tab, updated in-place.
// Events are routed to the tab matching the PUZZLE's level: level 1 -> L1,
// level 2 -> L2, level 3 -> L3 (falls back to the team's registered mission
// level when no puzzle level is known). Registration events go only to the
// Registration tab. All 3 level tabs share one schema and carry the unlock
// queues (Solved Puzzle IDs + Unlocked Puzzle IDs) + Total Score, so there is
// no separate TeamState sheet.

var GAME_STEP_ACTIONS = [
  'QR_SCANNED',
  'QR_BLOCKED',
  'PUZZLE_UNLOCKED',
  'UNLOCK_FAILED',
  'SOLVED',
  'WRONG_ATTEMPT',
  'HINT_REQUESTED',
  'HINT_USED',
  'PENALTY_TRIGGERED',
  'PENALTY',
  'MALPRACTICE_DETECTED',
  'PUZZLE_ABANDONED'
];

// Configure these in Apps Script → Project Settings → Script properties.
// PLAYER_TOKEN is used by player telemetry; ADMIN_TOKEN is used only for
// destructive admin actions and must never be shipped in runtime-config.js.
function getPlayerToken() {
  var token = PropertiesService.getScriptProperties().getProperty('PLAYER_TOKEN');
  if (!token) Logger.log('⚠️ Missing PLAYER_TOKEN script property');
  return token || '';
}

function getAdminToken() {
  var token = PropertiesService.getScriptProperties().getProperty('ADMIN_TOKEN');
  if (!token) Logger.log('⚠️ Missing ADMIN_TOKEN script property');
  return token || '';
}

// Server-side per-team request budget. The client already spaces calls through
// its own sliding-window limiter, but this guard caps any single team even if a
// client is modified/buggy (protects the shared concurrent-execution quota).
var TEAM_RATE_LIMIT = 90;         // max script entries per team per window
var TEAM_RATE_WINDOW_SECS = 60;   // sliding window length

// Sliding-window per-team budget, kept in CacheService so every concurrent
// execution shares the same counter without extra locking. Returns true when
// the team still has budget. Anonymous/admin calls (no team key) are unlimited.
function checkTeamRate(teamKey) {
  var key = String(teamKey || '').trim();
  if (!key || key === 'Unknown' || key === 'NO TEAM') return true;
  var cache = CacheService.getScriptCache();
  var bucketKey = 'rate_' + key.replace(/[^A-Za-z0-9_]/g, '_');
  var now = Math.floor(Date.now() / 1000);
  var bucket = [0, now];
  var raw = cache.get(bucketKey);
  if (raw) {
    try { bucket = JSON.parse(raw); } catch (e) { bucket = [0, now]; }
  }
  // Reset once the window has fully elapsed (strict > so an entry at exactly
  // WINDOW_SECS old is already outside the window, no off-by-one free request).
  if (now - Number(bucket[1]) > TEAM_RATE_WINDOW_SECS) bucket = [0, now];
  bucket[0] = Number(bucket[0] || 0) + 1;
  cache.put(bucketKey, JSON.stringify(bucket), TEAM_RATE_WINDOW_SECS + 1);
  return bucket[0] <= TEAM_RATE_LIMIT;
}

// Registration tab schema (8 cols). Level = numeric mission level (1/2/3).
// Security Key is stored only because the event owner asked for it — never
// exposed through doGet (see doGet, security key column is skipped).
var REG_HEADERS = [
  "Registration Time", "TID", "Team Name", "Mission", "Language",
  "Security Key", "Level", "Session ID"
];

// L1/L2/L3 share one schema. This is a per-PUZZLE log: each solved puzzle owns
// its own row (keyed by Team Name + Puzzle ID), so a team has one row per
// puzzle and PAST records are never overwritten by later puzzles. Puzzle ID =
// the record's key. Wrong Attempts / Solve Time / Hint Used / Tab Switches /
// Points Earned / Points Lost belong to that single puzzle. Unlocked Puzzle
// IDs = THE queue snapshot after this puzzle. Total Score = running score at
// that point.
var LEVEL_HEADERS = [
  "Last Active", "TID", "Team Name", "Mission", "Puzzle ID",
  "Wrong Attempts", "Solve Time", "Hint Used", "Tab Switches",
  "Points Earned", "Points Lost", "Status", "Total Score",
  "Unlocked Puzzle IDs", "Solved Puzzle IDs"
];

// ── Event idempotency ──
// Every client event carries a unique eventId. A send whose response is lost
// may be retried from the client's buffer, so we remember processed ids for a
// while and skip a second application (prevents duplicated point awards etc.).
var EVENT_DEDUPE_TTL_SECS = 21600; // 6h (CacheService max)

function eventCacheKey(eventId) {
  return 'evt_' + String(eventId).replace(/[^A-Za-z0-9_]/g, '_').substring(0, 200);
}

function isDuplicateEvent(eventId) {
  if (!eventId) return false;
  try {
    return CacheService.getScriptCache().get(eventCacheKey(eventId)) !== null;
  } catch (e) {
    return false;
  }
}

function markEventProcessed(eventId) {
  if (!eventId) return;
  try {
    CacheService.getScriptCache().put(eventCacheKey(eventId), '1', EVENT_DEDUPE_TTL_SECS);
  } catch (e) { }
}

// Handle CORS preflight requests
function doOptions(e) {
  return ContentService.createTextOutput('')
    .setMimeType(ContentService.MimeType.TEXT);
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  var lockAcquired = lock.tryLock(20000);

  try {
    if (!lockAcquired) {
      return ContentService.createTextOutput(JSON.stringify({ status: "error", message: "lock unavailable" }))
        .setMimeType(ContentService.MimeType.JSON);
    }

var ss = SpreadsheetApp.getActiveSpreadsheet();
    ensureSheetsExist(ss);

    // Reject malformed JSON bodies cleanly instead of throwing to the caller.
    var raw = (e && e.postData && e.postData.contents) || '';
    var data;
    try {
      data = JSON.parse(raw);
    } catch (perr) {
      return ContentService.createTextOutput(JSON.stringify({ status: "error", message: "bad json" }))
        .setMimeType(ContentService.MimeType.JSON);
    }
    if (!data || typeof data !== 'object' || !data.action || !data.token) {
      return ContentService.createTextOutput(JSON.stringify({ status: "error", message: "missing fields" }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    // RESET_ALL has a separate credential: the player-facing telemetry token
    // must never be enough to wipe every team record.
    if (data.action === 'RESET_ALL') {
      var adminToken = getAdminToken();
      if (!adminToken || data.adminToken !== adminToken) {
        return ContentService.createTextOutput(JSON.stringify({ status: "error", message: "unauthorized" }))
          .setMimeType(ContentService.MimeType.JSON);
      }

      var sheetsToWipe = ['Registration', 'L1', 'L2', 'L3'];
      sheetsToWipe.forEach(function(name) {
        var sheet = ss.getSheetByName(name);
        if (sheet && sheet.getLastRow() > 1) {
          sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).clearContent();
        }
      });
      var resetProps = PropertiesService.getScriptProperties();
      var resetEpoch = parseInt(resetProps.getProperty('gameEpoch') || '0', 10) + 1;
      resetProps.setProperty('gameEpoch', resetEpoch.toString());
      SpreadsheetApp.flush();
      return ContentService.createTextOutput(JSON.stringify({ status: "success", epoch: resetEpoch }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    var playerToken = getPlayerToken();
    if (!playerToken || data.token !== playerToken) {
      return ContentService.createTextOutput(JSON.stringify({ status: "error", message: "unauthorized" }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    // ── GET_TEAM_STATE: aggregate a team's per-puzzle rows (solved/current/unlocked/score) ──
    if (data.action === 'GET_TEAM_STATE') {
      var qTid = (data.tid || '').toString().trim();
      var solved = [];
      var currentPuzzle = null;
      var unlocked = [];
      var score = 0;
      var latestScoreTimestamp = -1;
      ['L1', 'L2', 'L3'].forEach(function(name) {
        var sheet = ss.getSheetByName(name);
        if (!sheet) return;
        var rows = sheet.getDataRange().getValues();
        for (var i = 1; i < rows.length; i++) {
          if (rows[i][1] && String(rows[i][1]).trim().toUpperCase() === qTid.toUpperCase()) {
            var pid = Number(rows[i][4] || 0);
            if (pid > 0) {
              if (rows[i][11] === 'SOLVED') solved.push(pid);
              currentPuzzle = pid; // rows appended chronologically → last wins
            }
            unlocked = unlocked.concat(parseIdList(rows[i][13]));
            solved = solved.concat(parseIdList(rows[i][14]));
            var rowTimestamp = new Date(rows[i][0]).getTime();
            if (isNaN(rowTimestamp)) rowTimestamp = 0;
            if (rowTimestamp >= latestScoreTimestamp) {
              latestScoreTimestamp = rowTimestamp;
              score = Number(rows[i][12] || 0);
            }
          }
        }
      });
      solved = uniqueNumbers(solved);
      unlocked = uniqueNumbers(unlocked);
      return ContentService.createTextOutput(JSON.stringify({
        status: 'success',
        solved: solved,
        currentPuzzle: currentPuzzle,
        unlocked: unlocked,
        score: score
      })).setMimeType(ContentService.MimeType.JSON);
    }

    // ── RESET ALL: wipe every sheet row (keep headers) + bump game epoch ──
    // ── Per-team budget: even a modified client can't flood the script ──
    if (!checkTeamRate(data.tid || data.teamName || '')) {
      // Acknowledge so the client clears its immediate buffer — no retry storm —
      // but do not process the request.
      return ContentService.createTextOutput(JSON.stringify({ status: "success", rateLimited: true }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    if (data.action === 'SESSION_BATCH' && Array.isArray(data.events)) {
      // Group buffered events by their target tab so each sheet is read ONCE,
      // then write back only the rows each event actually touched.
      var groups = {};
      data.events.forEach(function(event) {
        var label = eventSheetLabel(event);
        if (!label) return;
        (groups[label] = groups[label] || []).push(event);
      });
      Object.keys(groups).forEach(function(label) {
        var sheet = ss.getSheetByName(label);
        if (!sheet) return;
        var rows = sheet.getDataRange().getValues();
        var touched = {};
        var applied = [];
        var seen = {};
        groups[label].forEach(function(event) {
          var eid = event.eventId;
          if (eid && seen[eid]) return;
          if (isDuplicateEvent(eid)) return;
          if (eid) seen[eid] = true;
          var rowIdx = applyEvent(rows, event);
          if (rowIdx > 0) {
            touched[rowIdx] = true;
            applied.push(eid);
          }
        });
        Object.keys(touched).forEach(function(idx) {
          writeRow(sheet, rows, Number(idx));
        });
        applied.forEach(markEventProcessed);
      });
    } else {
      processEvent(ss, data);
    }

    SpreadsheetApp.flush();
    return ContentService.createTextOutput(JSON.stringify({ status: "success" }))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ status: "error", message: err.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  } finally {
    if (lockAcquired) {
      lock.releaseLock();
    }
  }
}

// Route an event to the tab it belongs to; returns '' when it should be skipped
// entirely (MEMEs, unknown/no team, non-game-step telemetry).
function eventSheetLabel(data) {
  var action = data.action || '';
  if (action.indexOf('MEME') !== -1) return '';

  var teamName = (data.teamName || data.team || '').toString().trim();
  if (!teamName || teamName === 'Unknown' || teamName === 'NO TEAM') return '';

  // 1. REGISTRATION TAB only (never a level tab)
  if (action === 'REGISTRATION') return 'Registration';

  // Ignore non-game-step telemetry (SESSION_START, CONNECTION_TEST, PROMISE_REJECTION, ...)
  if (GAME_STEP_ACTIONS.indexOf(action) === -1) return '';

  // 2. Route by the PUZZLE's level (L1/L2/L3) so each puzzle's data lands in
  //    the sheet matching its level. Falls back to the team's registered
  //    mission level when no puzzle level is present.
  var level = '';
  if (data.puzzleLevel == 1 || data.puzzleLevel === '1') level = 'L1';
  else if (data.puzzleLevel == 2 || data.puzzleLevel === '2') level = 'L2';
  else if (data.puzzleLevel == 3 || data.puzzleLevel === '3') level = 'L3';
  if (!level) {
    var m = (data.mission || '').split('_')[0].toUpperCase();
    if (m === 'L1' || m === 'L2' || m === 'L3') level = m;
  }
  return level;
}

// Single-event path: read the target tab once, apply one event, write back the
// one row it touched.
function processEvent(ss, data) {
  var label = eventSheetLabel(data);
  if (!label) return;
  if (isDuplicateEvent(data.eventId)) return;
  var sheet = ss.getSheetByName(label);
  if (!sheet) return;
  var rows = sheet.getDataRange().getValues();
  var rowIdx = applyEvent(rows, data);
  if (rowIdx > 0) {
    writeRow(sheet, rows, rowIdx);
    markEventProcessed(data.eventId);
  }
}

// Apply one event against a cached rows snapshot (header in rows[0]); returns
// the 1-based index of the row that changed (0 when nothing changed).
function applyEvent(rows, data) {
  var action = data.action || '';
  var timestamp = data.timestamp || new Date().toISOString();
  var teamName = (data.teamName || data.team || '').toString().trim();
  var tid = (data.tid || '').toString().trim();
  var mission = (data.mission || '').toString();

  if (action === 'REGISTRATION') {
    return applyRegistrationRow(rows, teamName, tid, data, timestamp);
  }
  return applyLevelRow(rows, teamName, tid, mission, action, data, timestamp);
}

// Update Registration Sheet Row (8 cols: REG_HEADERS order). Returns row index.
function applyRegistrationRow(rows, teamName, tid, data, timestamp) {
  var rowIdx = findTeamRow(rows, teamName);
  var rowArray = [
    timestamp,
    tid,
    teamName,
    data.mission || '',
    data.language || '',
    data.securityKey || '',
    data.level || '',
    data.sessionId || ''
  ];
  if (rowIdx > 0) {
    rows[rowIdx - 1] = rowArray;
  } else {
    rows.push(rowArray);
    rowIdx = rows.length;
  }
  return rowIdx;
}

// Normalise a truthy value coming from a sheet cell. The script writes '1'/'0',
// but a cell may be hand-edited to 'TRUE'/'true'/'TRUE ' /'YES'/'Y' or a boolean
// TRUE, so accept any positive marker case-insensitively instead of only '1'.
function isHintFlag(val) {
  if (val === true || val === 1 || val === '1') return true;
  if (typeof val !== 'string') return false;
  var v = val.trim().toLowerCase();
  return v === 'true' || v === 'yes' || v === 'y' || v === '1';
}

// Per-PUZZLE row updater for L1/L2/L3 tabs. One row per (team, puzzle):
// a fresh row is appended for each new puzzle, and only THAT row is updated
// while the puzzle is in progress. Past records are frozen once a puzzle is
// solved or abandoned.
function applyLevelRow(rows, teamName, tid, mission, action, data, timestamp) {
  // LEVEL_HEADERS:
  //  0 Last Active · 1 TID · 2 Team Name · 3 Mission · 4 Puzzle ID
  //  5 Wrong Attempts · 6 Solve Time · 7 Hint Used · 8 Tab Switches
  //  9 Points Earned · 10 Points Lost · 11 Status · 12 Total Score
  //  13 Unlocked Puzzle IDs
  var puzzleId = Number(data.puzzleId);
  if (isNaN(puzzleId) || puzzleId < 0) puzzleId = 0;

  // Locate this team's row for THIS puzzle; if unknown id, fall back to the
  // team's open (empty-id) row, else append a new one. rowIdx is 1-based
  // (rows[0] = header row).
  var rowIdx = findPuzzleRow(rows, teamName, puzzleId);
  var isNewPuzzle = false;
  if (rowIdx === -1) {
    if (puzzleId > 0) {
      rowIdx = findPuzzleRow(rows, teamName, 0, true);
      if (rowIdx === -1) {
        isNewPuzzle = true;
      }
    } else {
      isNewPuzzle = true;
    }
  }

  var record = {
    lastActive: timestamp,
    tid: '',
    teamName: teamName,
    mission: mission,
    puzzleId: isNewPuzzle ? puzzleId : 0,
    wrongAttempts: 0,
    solveTime: '',
    hintUsed: '0',
    tabSwitches: 0,
    pointsEarned: 0,
    pointsLost: 0,
    status: 'ACTIVE',
    totalScore: 0,
    unlockedPuzzles: '',
    solvedPuzzles: ''
  };

  if (!isNewPuzzle) {
    var vals = rows[rowIdx - 1];
    record.tid = tid || vals[1];
    record.teamName = vals[2] || teamName;
    record.mission = mission || vals[3] || '';
    record.puzzleId = Number(vals[4] || puzzleId || 0);
    record.wrongAttempts = parseInt(vals[5] || 0);
    record.solveTime = vals[6] || '';
    // Sheets may coerce the text "1" to a numeric 1 on write, so normalise.
    record.hintUsed = isHintFlag(vals[7]) ? '1' : '0';
    record.tabSwitches = parseInt(vals[8] || 0);
    record.pointsEarned = Number(vals[9] || 0);
    record.pointsLost = Number(vals[10] || 0);
    record.status = vals[11] || 'ACTIVE';
    record.totalScore = Number(vals[12] || 0);
    record.unlockedPuzzles = vals[13] || '';
    record.solvedPuzzles = vals[14] || '';
  } else {
    record.tid = tid || '';
    record.puzzleId = puzzleId;
  }

  // A puzzle that reached SOLVED must never be visually downgraded by a late
  // retried event (WRONG_ATTEMPT, PENALTY, HINT_USED, QR_BLOCKED, ...). Those
  // may still update counters below, but the SOLVED status is sealed here.
  var wasSolved = record.status === 'SOLVED';

  if (action === 'SOLVED') {
    var pts = Number(data.pointsEarned || 0);
    if (pts > 0) {
      record.pointsEarned += pts;
    } else if (pts < 0) {
      record.pointsLost += Math.abs(pts);
    }
    record.status = 'SOLVED';
    record.solveTime = timestamp;
    record.lastActive = timestamp;
    // The one-request-per-puzzle summary ships the whole notebook inside SOLVED:
    // wrong attempts, hint usage, tab switches for THIS puzzle, the unlock
    // queue (ids) and the running score.
    if (typeof data.wrongAttempts === 'number') record.wrongAttempts = Math.max(record.wrongAttempts, data.wrongAttempts);
    if (typeof data.tabSwitches === 'number') record.tabSwitches = Math.max(record.tabSwitches, data.tabSwitches);
    if (data.hintUsed) record.hintUsed = '1';
    // THE QUEUE: merge every unlocked id from this solve, no duplicates
    var queue = record.unlockedPuzzles ? record.unlockedPuzzles.split(',').map(Number) : [];
    (Array.isArray(data.queueIds) ? data.queueIds : []).forEach(function(id) {
      var n = Number(id);
      if (!isNaN(n) && n > 0 && queue.indexOf(n) === -1) queue.push(n);
    });
    record.unlockedPuzzles = queue.join(',');
    var solvedQueue = record.solvedPuzzles ? record.solvedPuzzles.split(',').map(Number) : [];
    (Array.isArray(data.solvedIds) ? data.solvedIds : []).concat([puzzleId]).forEach(function(id) {
      var n = Number(id);
      if (!isNaN(n) && n > 0 && solvedQueue.indexOf(n) === -1) solvedQueue.push(n);
    });
    record.solvedPuzzles = solvedQueue.join(',');
    record.totalScore = Number(data.score || 0);
  } else if (action === 'PUZZLE_ABANDONED') {
    // A puzzle already SOLVED must never be downgraded by a late/retried
    // ABANDONED (buffered SOLVED + unload race).
    if (record.status === 'SOLVED') return 0;
    // Half-solved puzzle left open: sync its counters, award no points.
    if (typeof data.wrongAttempts === 'number') record.wrongAttempts = Math.max(record.wrongAttempts, data.wrongAttempts);
    if (typeof data.tabSwitches === 'number') record.tabSwitches = Math.max(record.tabSwitches, data.tabSwitches);
    if (data.hintUsed) record.hintUsed = '1';
    record.status = 'ABANDONED';
    record.lastActive = timestamp;
  } else if (action === 'WRONG_ATTEMPT') {
    // Client throttles these events; attemptCount carries the true cumulative
    // tally so the sheet count stays exact even when individual events are dropped.
    if (typeof data.attemptCount === 'number') {
      record.wrongAttempts = Math.max(parseInt(record.wrongAttempts || 0), data.attemptCount);
    } else {
      record.wrongAttempts += 1;
    }
    record.status = 'RETRYING';
    record.lastActive = timestamp;
  } else if (action === 'PUZZLE_UNLOCKED') {
    record.status = 'UNLOCKED';
  } else if (action === 'UNLOCK_FAILED') {
    record.status = 'LOCKED';
  } else if (action === 'QR_BLOCKED') {
    record.status = 'BLOCKED';
  } else if (action === 'PENALTY_TRIGGERED' || action === 'PENALTY' || action === 'MALPRACTICE_DETECTED') {
    record.status = 'MALPRACTICE';
    record.lastActive = timestamp;
    if (typeof data.penaltyCount === 'number') record.tabSwitches = data.penaltyCount;
    else if (typeof data.tabSwitches === 'number') record.tabSwitches = data.tabSwitches;
    else record.tabSwitches += 1;
  } else if (action === 'HINT_USED' || action === 'HINT_REQUESTED') {
    record.hintUsed = '1';
    if (typeof data.hintTabSwitchesDuringPenalty === 'number') {
      record.tabSwitches = data.hintTabSwitchesDuringPenalty;
    } else if (typeof data.tabSwitchesDuringPenalty === 'number') {
      record.tabSwitches = data.tabSwitchesDuringPenalty;
    }
  }

  // Sealed: a solved puzzle's row keeps SOLVED no matter what late/retried
  // non-solve event touches it (it already earned its points + solve time).
  if (wasSolved && record.status !== 'SOLVED') record.status = 'SOLVED';

  var rowArray = [
    record.lastActive,
    record.tid,
    record.teamName,
    record.mission,
    record.puzzleId,
    record.wrongAttempts,
    record.solveTime,
    record.hintUsed,
    record.tabSwitches,
    record.pointsEarned,
    record.pointsLost,
    record.status,
    record.totalScore,
    record.unlockedPuzzles,
    record.solvedPuzzles
  ];

  if (isNewPuzzle) {
    rows.push(rowArray);
    rowIdx = rows.length;
  } else {
    rows[rowIdx - 1] = rowArray;
  }
  return rowIdx;
}

function findTeamRow(rows, teamName) {
  for (var i = 1; i < rows.length; i++) {
    if (rows[i][2] && rows[i][2].toString().trim().toUpperCase() === teamName.toUpperCase()) {
      return i + 1;
    }
  }
  return -1;
}

// One row per (team, puzzle). Row key = Team Name (col 2) + Puzzle ID (col 4).
// nullPuzzleMatch = also allow rows whose Puzzle ID is empty (unknown id).
function findPuzzleRow(rows, teamName, puzzleId, nullPuzzleMatch) {
  for (var i = 1; i < rows.length; i++) {
    if (rows[i][2] && rows[i][2].toString().trim().toUpperCase() === teamName.toUpperCase()) {
      var rowPid = rows[i][4];
      var rowHasPid = rowPid && String(rowPid).trim() !== '';
      if (puzzleId) {
        if (rowHasPid && Number(rowPid) === Number(puzzleId)) return i + 1;
      } else if (nullPuzzleMatch && !rowHasPid) {
        return i + 1;
      }
    }
  }
  return -1;
}

// Write one mutated row back to its sheet (minimal write — no full-sheet flush).
function writeRow(sheet, rows, rowIdx) {
  if (rowIdx <= 0 || !rows[rowIdx - 1]) return;
  sheet.getRange(rowIdx, 1, 1, rows[0].length).setValues([rows[rowIdx - 1]]);
}

// Parse a CSV of puzzle ids ("2,6" or "2|6") into a number array.
function parseIdList(text) {
  if (!text) return [];
  return String(text)
    .split(/[,\s]+/)
    .map(function(s) { return parseInt(s, 10); })
    .filter(function(n) { return !isNaN(n); });
}

// Dedup + sort a raw number list (used by GET_TEAM_STATE aggregation).
function uniqueNumbers(list) {
  var seen = {};
  var out = [];
  (list || []).forEach(function(n) {
    n = Number(n);
    if (!isNaN(n) && !seen[n]) { seen[n] = true; out.push(n); }
  });
  return out;
}

// Lazy tab setup: create a missing sheet, and write/styles the header row ONLY
// when a tab has no rows at all. Existing tabs are untouched, so the 8+ header
// writes that used to happen on every request are now a one-time cost.
function ensureSheetsExist(ss) {
  var tabs = [
    { name: "Registration", headers: REG_HEADERS },
    { name: "L1", headers: LEVEL_HEADERS },
    { name: "L2", headers: LEVEL_HEADERS },
    { name: "L3", headers: LEVEL_HEADERS }
  ];

  tabs.forEach(function(t) {
    var sheet = ss.getSheetByName(t.name);
    if (!sheet) {
      sheet = ss.insertSheet(t.name);
    }
    if (sheet.getLastRow() <= 0) {
      var headerRange = sheet.getRange(1, 1, 1, t.headers.length);
      headerRange.setValues([t.headers]);
      headerRange.setFontWeight("bold").setBackground("#1e293b").setFontColor("#ffffff");
    }
  });
}

// Serves clean aggregated JSON data to the Admin Dashboard
function doGet(e) {
  try {
    var playerToken = getPlayerToken();
    if (!playerToken || !e.parameter.token || e.parameter.token !== playerToken) {
      return ContentService.createTextOutput(JSON.stringify({ error: true, message: "unauthorized" }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    // ── Clients check the epoch on load to wipe stale local progress ──
    //    (checked BEFORE any Sheets access so a lightweight epoch ping costs nothing)
    if (e.parameter.action === 'GET_EPOCH') {
      var props = PropertiesService.getScriptProperties();
      var epoch = parseInt(props.getProperty('gameEpoch') || '0', 10);
      return ContentService.createTextOutput(JSON.stringify({ epoch: epoch }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    ensureSheetsExist(ss);

    var list = [];

    // 1. Read Registration (security key column is intentionally NOT exposed)
    var regSheet = ss.getSheetByName("Registration");
    var regData = regSheet ? regSheet.getDataRange().getValues() : [];
    for (var i = 1; i < regData.length; i++) {
      list.push({
        isSummary: true,
        action: 'REGISTRATION',
        registered: true,
        lastActive: regData[i][0],
        tid: regData[i][1],
        teamName: regData[i][2],
        mission: regData[i][3],
        language: regData[i][4],
        level: regData[i][6]
      });
    }

    // 2. Read L1/L2/L3 (identical 14-col per-puzzle log schemas)
    ['L1', 'L2', 'L3'].forEach(function(sheetName) {
      var sheet = ss.getSheetByName(sheetName);
      var rows = sheet ? sheet.getDataRange().getValues() : [];
      for (var j = 1; j < rows.length; j++) {
        // Skip filler rows with no real puzzle id (event arrived before any
        // puzzle was active / open-row placeholder). They carry no scoring info.
        var pid = parseInt(rows[j][4] || 0);
        if (!pid) continue;
        list.push({
          isSummary: true,
          action: 'SUMMARY',
          lastActive: rows[j][0],
          tid: rows[j][1],
          teamName: rows[j][2],
          mission: rows[j][3],
          level: sheetName,
          puzzleId: pid,
          wrongAttempts: parseInt(rows[j][5] || 0),
          solveTime: rows[j][6],
          hintUsed: isHintFlag(rows[j][7]),
          tabSwitches: parseInt(rows[j][8] || 0),
          pointsEarned: parseInt(rows[j][9] || 0),
          pointsLost: parseInt(rows[j][10] || 0),
          status: rows[j][11],
          totalScore: parseInt(rows[j][12] || 0),
          unlockedPuzzles: rows[j][13],
          solvedPuzzles: rows[j][14]
        });
      }
    });

    return ContentService.createTextOutput(JSON.stringify(list))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ error: true, message: err.toString() })).setMimeType(ContentService.MimeType.JSON);
  }
}
