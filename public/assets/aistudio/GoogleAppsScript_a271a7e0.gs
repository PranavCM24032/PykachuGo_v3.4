// =================================================================
// PYKACHU GO - FINAL BACKEND SCRIPT (STRICT SCHEMA & IMMUTABLE)
// =================================================================

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

function getSpreadsheet_() {
  var active = SpreadsheetApp.getActiveSpreadsheet();
  if (active) return active;
  try { return SpreadsheetApp.openById('1Owj4i-89RnXO-UipEVBvOcqYs2r5vdyG7vYRB8_F_X0'); }
  catch (e) { Logger.log('Could not open the configured spreadsheet: ' + e); }
  return null;
}

// ── Server-authoritative puzzle catalogue ────────────────────────────────
// Puzzle content and login are handled locally; Apps Script stores records.
// Reads a cell as text, removing the leading apostrophe that safeCell() adds
// to formula-like values so identity matching still works after sanitising.
function cellText_(value) {
  var s = String(value == null ? '' : value).trim();
  return s.charAt(0) === "'" ? s.slice(1) : s;
}

function computeAllowedFromSolved(solved) {
  return uniqueNumbers(solved || []).sort(function(a, b) { return a - b; });
}

function safeCell(value) {
  if (value === null || value === undefined) return '';
  if (typeof value !== 'string') return value;
  // A leading = + - or @ is interpreted as a formula by Google Sheets.
  return /^[=+\-@]/.test(value) ? "'" + value : value;
}

function teamRowMatches(row, tidIndex, teamIndex, tid, teamName) {
  if (!row || row.length <= Math.max(tidIndex, teamIndex)) return false;
  var tId = cellText_(tid).toUpperCase();
  var tName = cellText_(teamName).toUpperCase();
  var rowTid = cellText_(row[tidIndex]).toUpperCase();
  var rowTeam = cellText_(row[teamIndex]).toUpperCase();
  return Boolean((tId && rowTid === tId) || (tName && rowTeam === tName));
}

function getTeamContext(ss, tid, teamName) {
  if (!ss) {
    return { solved: [], points: 0, hintsUsed: [], currentPuzzle: null, rowIndexes: {} };
  }
  var cache = CacheService.getScriptCache();
  var cKey = teamContextCacheKey_(tid, teamName);
  var cached = cKey ? cache.get(cKey) : null;
  if (cached) {
    try { return JSON.parse(cached); } catch (e) { }
  }

  var solved = [];
  var points = 0;
  var hintsUsed = [];
  var rowIndexes = {};
  var currentPuzzle = null;
  var latestPuzzleTimestamp = -1;

  ['L1', 'L2', 'L3'].forEach(function(name) {
    var sheet = ss.getSheetByName(name);
    if (!sheet) return;
    var rows = sheet.getDataRange().getValues();
    for (var i = 1; i < rows.length; i++) {
      if (!rows[i] || rows[i].every(function(c) { return c === '' || c === null || c === undefined; })) continue;
      if (!teamRowMatches(rows[i], 0, 1, tid, teamName)) continue;
      var status = String(rows[i][9] || '');
      var pid = Number(rows[i][3] || 0);

      if (pid > 0 && status !== 'REPEAT_SOLVE' && !rowIndexes[pid]) {
        rowIndexes[pid] = { sheet: name, row: i + 1 };
      }

      if (status === 'SOLVED' || status === 'REPEAT_SOLVE') {
        if (pid > 0) solved.push(pid);
        points += Number(rows[i][8] || 0) || 0;
      }

      if (pid > 0 && isHintFlag(rows[i][6])) {
        hintsUsed.push(pid);
      }

      var rowTimestamp = new Date(rows[i][5]).getTime();
      if (isNaN(rowTimestamp)) rowTimestamp = 0;
      if (pid > 0 && rowTimestamp >= latestPuzzleTimestamp) {
        latestPuzzleTimestamp = rowTimestamp;
        currentPuzzle = pid;
      }
    }
  });

  var result = {
    solved: uniqueNumbers(solved),
    points: points,
    hintsUsed: uniqueNumbers(hintsUsed),
    currentPuzzle: currentPuzzle,
    currentPuzzleTimestamp: latestPuzzleTimestamp,
    rowIndexes: rowIndexes
  };

  cacheTeamContext_(tid, teamName, result);
  return result;
}

function invalidateTeamContext(tid, teamName) {
  try {
    var cKey = teamContextCacheKey_(tid, teamName);
    if (cKey) CacheService.getScriptCache().remove(cKey);
  } catch (e) { }
}

function teamContextCacheKey_(tid, teamName) {
  var identity = String(tid || teamName || '').replace(/[^A-Za-z0-9_]/g, '_').substring(0, 180);
  if (!identity) return '';
  var epoch = CacheService.getScriptCache().get('gameEpoch') || '0';
  return 'ctx2_' + epoch + '_' + identity;
}

function cacheTeamContext_(tid, teamName, context) {
  var cKey = teamContextCacheKey_(tid, teamName);
  if (!cKey || !context) return;
  try {
    CacheService.getScriptCache().put(cKey, JSON.stringify(context), TEAM_CONTEXT_CACHE_TTL_SECS);
  } catch (e) {
    Logger.log('Could not cache team context: ' + e);
  }
}

function getCachedTeamContext_(tid, teamName) {
  var cKey = teamContextCacheKey_(tid, teamName);
  if (!cKey) return null;
  try {
    var cached = CacheService.getScriptCache().get(cKey);
    return cached ? JSON.parse(cached) : null;
  } catch (e) {
    return null;
  }
}

function updateTeamContextForEvent_(context, sheet, rowIdx, data, row) {
  if (!context || rowIdx <= 0 || !row) return;
  var puzzleId = Number(data.puzzleId || row[3] || 0);
  if (puzzleId <= 0) return;

  context.rowIndexes = context.rowIndexes || {};
  if (String(row[9] || '') !== 'REPEAT_SOLVE' && !context.rowIndexes[puzzleId]) {
    context.rowIndexes[puzzleId] = { sheet: sheet.getName(), row: rowIdx };
  }
  if (isHintFlag(row[6]) && context.hintsUsed.indexOf(puzzleId) === -1) {
    context.hintsUsed.push(puzzleId);
  }

  var rowTimestamp = new Date(row[5]).getTime();
  if (isNaN(rowTimestamp)) rowTimestamp = 0;
  if (rowTimestamp >= Number(context.currentPuzzleTimestamp || -1)) {
    context.currentPuzzle = puzzleId;
    context.currentPuzzleTimestamp = rowTimestamp;
  }
}

function getAnswerRows_(sheet, context, tid, teamName, puzzleId) {
  var location = context && context.rowIndexes && context.rowIndexes[puzzleId];
  var lastRow = sheet.getLastRow();
  if (!location) return new Array(lastRow);
  if (location && location.sheet === sheet.getName() &&
      location.row > 1 && location.row <= lastRow) {
    try {
      var row = sheet.getRange(location.row, 1, 1, LEVEL_HEADERS.length).getValues()[0];
      if (teamRowMatches(row, 0, 1, tid, teamName) &&
          Number(row[3]) === Number(puzzleId) &&
          String(row[9] || '') !== 'REPEAT_SOLVE') {
        var rows = new Array(lastRow);
        rows[location.row - 1] = row;
        return rows;
      }
    } catch (e) {
      Logger.log('Could not read cached answer row; scanning the level sheet: ' + e);
    }
  }
  return sheet.getDataRange().getValues();
}

function getTeamIdentity_(data) {
  if (!data) return null;
  var tid = String(data.tid || '').trim();
  var teamName = String(data.teamName || data.team || '').trim();
  return tid || teamName ? { tid: tid, teamName: teamName } : null;
}

function jsonResponse_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

var TEAM_RATE_LIMIT = 90;
var TEAM_RATE_WINDOW_SECS = 60;
var TEAM_CONTEXT_CACHE_TTL_SECS = 21600;

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
  if (now - Number(bucket[1]) > TEAM_RATE_WINDOW_SECS) bucket = [0, now];
  bucket[0] = Number(bucket[0] || 0) + 1;
  cache.put(bucketKey, JSON.stringify(bucket), TEAM_RATE_WINDOW_SECS + 1);
  return bucket[0] <= TEAM_RATE_LIMIT;
}

// REGISTRATION HEADERS (7 cols)
var REG_HEADERS = [
  "Registration Time", "TID", "Team Name", "Mission", "Language",
  "Level", "Session ID"
];

// LEVEL HEADERS (13 cols)
var LEVEL_HEADERS = [
  "TID", "Team Name", "Mission", "Puzzle ID",
  "Wrong Attempts", "Timestamp", "Hint Used", "Tab Switches",
  "Points", "Status", "Total Score",
  "Unlocked Puzzle IDs", "Solved Puzzle IDs"
];

var EVENT_DEDUPE_TTL_SECS = 21600;

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

function doOptions(e) {
  return ContentService.createTextOutput('')
    .setMimeType(ContentService.MimeType.TEXT);
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  var lockAcquired = false;

  try {
    var raw = (e && e.postData && e.postData.contents) || '';
    var data;
    try {
      data = JSON.parse(raw);
    } catch (perr) {
      return ContentService.createTextOutput(JSON.stringify({ status: "error", message: "bad json" }))
        .setMimeType(ContentService.MimeType.JSON);
    }
    if (!data || typeof data !== 'object' || !data.action) {
      return ContentService.createTextOutput(JSON.stringify({ status: "error", message: "missing fields" }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    if (data.action === 'ADMIN_AUTH') {
      return jsonResponse_({ status: 'success', session: 'local-admin-session' });
    }

    if (data.action === 'ADMIN_GET_DATA') {
      return jsonResponse_(getAdminData_());
    }

    if (data.action === 'RESET_ALL') {

      lockAcquired = lock.tryLock(30000);
      if (!lockAcquired) {
        return ContentService.createTextOutput(JSON.stringify({ status: "error", message: "lock unavailable" }))
          .setMimeType(ContentService.MimeType.JSON);
      }

      var resetSpreadsheet = getSpreadsheet_();
      if (!resetSpreadsheet) {
        return jsonResponse_({ status: 'error', message: 'Could not connect to Google Spreadsheet.' });
      }
      ensureSheetsExist(resetSpreadsheet);
      ['L1', 'L2', 'L3'].forEach(function(name) {
        var sheet = resetSpreadsheet.getSheetByName(name);
        var values = sheet ? sheet.getDataRange().getValues() : [];
        for (var i = 1; i < values.length; i++) {
          invalidateTeamContext(values[i][0], values[i][1]);
        }
      });
      var sheetsToWipe = ['Registration', 'L1', 'L2', 'L3'];
      sheetsToWipe.forEach(function(name) {
        var sheet = resetSpreadsheet.getSheetByName(name);
        if (sheet && sheet.getLastRow() > 1) {
          sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).clearContent();
        }
      });
      var resetEpoch = Date.now();
      CacheService.getScriptCache().put('gameEpoch', String(resetEpoch), 21600);
      SpreadsheetApp.flush();
      return ContentService.createTextOutput(JSON.stringify({ status: "success", epoch: resetEpoch }))
        .setMimeType(ContentService.MimeType.JSON);
    }


    var ss = getSpreadsheet_();
    if (!ss) {
      return jsonResponse_({ status: 'error', message: 'Could not connect to Google Spreadsheet.' });
    }
    if (data.action === 'GET_TEAM_STATE') {
      var missingSheet = ['Registration', 'L1', 'L2', 'L3'].some(function(name) {
        return !ss.getSheetByName(name);
      });
      if (missingSheet) {
        lockAcquired = lock.tryLock(30000);
        if (!lockAcquired) {
          return ContentService.createTextOutput(JSON.stringify({ status: "error", message: "lock unavailable" }))
            .setMimeType(ContentService.MimeType.JSON);
        }
        ensureSheetsExist(ss);
        lock.releaseLock();
        lockAcquired = false;
      }

      // The selected team identity is supplied by the browser.
      var stateSession = getTeamIdentity_(data);
      if (!stateSession) {
        return jsonResponse_({ status: 'error', message: 'login required' });
      }
      var qTid = (stateSession.tid || '').toString().trim();
      var qName = (stateSession.teamName || '').toString().trim();
      var ctx = getTeamContext(ss, qTid, qName);
      var solved = ctx.solved.slice();
      var unlocked = computeAllowedFromSolved(solved);

      return jsonResponse_({
        status: 'success',
        solved: solved,
        currentPuzzle: ctx.currentPuzzle || null,
        unlocked: unlocked,
        hintsUsed: ctx.hintsUsed || [],
        score: ctx.points
      });
    }

    lockAcquired = lock.tryLock(30000);
    if (!lockAcquired) {
      return ContentService.createTextOutput(JSON.stringify({ status: "error", message: "lock unavailable" }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    ensureSheetsExist(ss);

    // Each write is grouped under the selected team identity supplied by the browser.
    var writeSession = getTeamIdentity_(data);
    if (!writeSession) {
      return jsonResponse_({ status: 'error', message: 'login required' });
    }

    var rateLimitTeam = writeSession.tid || writeSession.teamName || '';
    if (!checkTeamRate(rateLimitTeam)) {
      return ContentService.createTextOutput(JSON.stringify({
        status: "rate_limited",
        message: "Team request limit reached",
        retryAfterSeconds: TEAM_RATE_WINDOW_SECS
      })).setMimeType(ContentService.MimeType.JSON);
    }

    if (data.action === 'SESSION_BATCH' && Array.isArray(data.events)) {
      data.events.forEach(function(event) {
        event.tid = writeSession.tid || event.tid;
        event.teamName = writeSession.teamName || event.teamName;
      });
      var batchCtx = getTeamContext(ss, writeSession.tid, writeSession.teamName);
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
          var rowIdx = applyEvent(rows, event, batchCtx);
          if (rowIdx > 0) {
            touched[rowIdx] = true;
            applied.push(eid);
            updateTeamContextForEvent_(batchCtx, sheet, rowIdx, event, rows[rowIdx - 1]);
          }
        });

        Object.keys(touched).forEach(function(idx) {
          writeRow(sheet, rows, Number(idx));
        });
        applied.forEach(markEventProcessed);
        if (Object.keys(touched).length > 0) {
          cacheTeamContext_(writeSession.tid, writeSession.teamName, batchCtx);
        }
      });
    } else {
      data.tid = writeSession.tid || data.tid;
      data.teamName = writeSession.teamName || data.teamName;
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

function eventSheetLabel(data) {
  var action = data.action || '';
  if (action.indexOf('MEME') !== -1) return '';

  var teamName = (data.teamName || data.team || '').toString().trim();
  if (!teamName || teamName === 'Unknown' || teamName === 'NO TEAM') return '';

  if (action === 'REGISTRATION') return 'Registration';

  if (GAME_STEP_ACTIONS.indexOf(action) === -1) return '';

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

function processEvent(ss, data) {
  var label = eventSheetLabel(data);
  if (!label) return;
  if (isDuplicateEvent(data.eventId)) return;
  var sheet = ss.getSheetByName(label);
  if (!sheet) return;
  var rows = sheet.getDataRange().getValues();
  var ctx = data.action === 'SOLVED' ? getTeamContext(ss, data.tid, data.teamName) : null;
  var rowIdx = applyEvent(rows, data, ctx);
  if (rowIdx > 0) {
    writeRow(sheet, rows, rowIdx);
    markEventProcessed(data.eventId);
    var cachedContext = getCachedTeamContext_(data.tid, data.teamName);
    if (cachedContext) {
      updateTeamContextForEvent_(cachedContext, sheet, rowIdx, data, rows[rowIdx - 1]);
      cacheTeamContext_(data.tid, data.teamName, cachedContext);
    }
  }
}

function applyEvent(rows, data, ctx) {
  var action = data.action || '';
  var timestamp = data.timestamp || new Date().toISOString();
  var teamName = (data.teamName || data.team || '').toString().trim();
  var tid = (data.tid || '').toString().trim();
  var mission = (data.mission || '').toString();

  if (action === 'REGISTRATION') {
    return applyRegistrationRow(rows, teamName, tid, data, timestamp);
  }
  return applyLevelRow(rows, teamName, tid, mission, action, data, timestamp, ctx);
}

function applyRegistrationRow(rows, teamName, tid, data, timestamp) {
  var rowIdx = findTeamRow(rows, teamName, tid);
  var safeTid = safeCell(tid);
  var safeTeam = safeCell(teamName);
  var rowArray = [
    timestamp,
    safeTid,
    safeTeam,
    safeCell(data.mission || ''),
    safeCell(data.language || ''),
    safeCell(data.level || ''),
    safeCell(data.sessionId || '')
  ];

  if (rowIdx > 0) {
    var existing = rows[rowIdx - 1];
    existing[0] = existing[0] || timestamp;
    existing[1] = safeTid || existing[1];
    existing[2] = safeTeam || existing[2];
    existing[3] = safeCell(data.mission || '') || existing[3];
    existing[4] = safeCell(data.language || '') || existing[4];
    existing[5] = safeCell(data.level || '') || existing[5];
    existing[6] = safeCell(data.sessionId || '') || existing[6];
  } else {
    rows.push(rowArray);
    rowIdx = rows.length;
  }
  return rowIdx;
}

function isHintFlag(val) {
  if (val === true || val === 1 || val === '1') return true;
  if (typeof val !== 'string') return false;
  var v = val.trim().toLowerCase();
  return v === 'true' || v === 'yes' || v === 'y' || v === '1';
}

function applyLevelRow(rows, teamName, tid, mission, action, data, timestamp, ctx) {
  var puzzleId = Number(data.puzzleId);
  if (isNaN(puzzleId) || puzzleId < 0) puzzleId = 0;

  var rowIdx = findPuzzleRow(rows, teamName, tid, puzzleId);
  var isNewPuzzle = false;

  if (rowIdx === -1) {
    if (puzzleId > 0) {
      rowIdx = findPuzzleRow(rows, teamName, tid, 0, true);
      if (rowIdx === -1) {
        isNewPuzzle = true;
      }
    } else {
      isNewPuzzle = true;
    }
  }

  // Telemetry-only actions update counters on an existing row, but never
  // create or seal a row. This keeps wrong-attempt / tab-switch / hint data
  // visible even when the team never reaches a terminal state.
  if (action !== 'SOLVED' && action !== 'PUZZLE_ABANDONED') {
    if (rowIdx <= 0) {
      if (puzzleId <= 0) return -1;
      var newRow = [
        safeCell(tid),
        safeCell(teamName),
        safeCell(mission || ('L' + (data.puzzleLevel || 1) + '_PUZZLE_' + puzzleId)),
        puzzleId,
        0,
        timestamp,
        '0',
        0,
        '',
        '',
        '',
        '',
        ''
      ];
      rows.push(newRow);
      rowIdx = rows.length;
    }
    var telemetry = rows[rowIdx - 1].slice();
    if (typeof data.wrongAttempts === 'number') {
      telemetry[4] = Math.max(parseInt(telemetry[4] || 0, 10), data.wrongAttempts);
    }
    if (typeof data.attemptCount === 'number') {
      telemetry[4] = Math.max(parseInt(telemetry[4] || 0, 10), data.attemptCount);
    }
    if (typeof data.tabSwitches === 'number') {
      telemetry[7] = Math.max(parseInt(telemetry[7] || 0, 10), data.tabSwitches);
    }
    if (isHintFlag(data.hintUsed) || (typeof data.hintsUsed === 'number' && data.hintsUsed > 0)) {
      telemetry[6] = '1';
    }
    rows[rowIdx - 1] = telemetry;
    return rowIdx;
  }

  if (action === 'SOLVED' && !isFinite(Number(data.points))) return -1;

  var existingStatus = (rowIdx > 0) ? String(rows[rowIdx - 1][9] || '') : '';

  // A SOLVED row is sealed for further upgrades, but a REPEAT solve of an
  // already-solved puzzle must still be RECORDED as a brand-new row carrying
  // the negative (deduction) points — never merged into the sealed row.
  var isRepeatSolve = false;
  if (existingStatus === 'SOLVED') {
    if (action !== 'SOLVED') return -1;
    isRepeatSolve = true;
    isNewPuzzle = true;
    rowIdx = -1;
    existingStatus = '';
  }
  if (ctx && puzzleId > 0 && ctx.solved && ctx.solved.indexOf(puzzleId) !== -1) {
    isRepeatSolve = true;
    isNewPuzzle = true;
    rowIdx = -1;
  }

  // A mid-way row is recorded once. Only a later SOLVED may upgrade it;
  // another PUZZLE_ABANDONED (or anything else) must not rewrite it.
  if (rowIdx > 0 && action !== 'SOLVED') return -1;

  var record = {
    tid: tid || '',
    teamName: teamName,
    mission: mission,
    puzzleId: puzzleId,
    wrongAttempts: 0,
    timestamp: '',
    hintUsed: '0',
    tabSwitches: 0,
    points: '',
    status: '',   // EMPTY unless solved
    totalScore: '',
    unlockedPuzzles: '',
    solvedPuzzles: ''
  };

  if (!isNewPuzzle && rowIdx > 0) {
    var vals = rows[rowIdx - 1];
    record.tid = tid || cellText_(vals[0]);
    record.teamName = cellText_(vals[1]) || teamName;
    record.mission = mission || vals[2] || '';
    record.puzzleId = Number(vals[3] || puzzleId || 0);
    record.wrongAttempts = parseInt(vals[4] || 0, 10);
    record.timestamp = vals[5] || '';
    record.hintUsed = isHintFlag(vals[6]) ? '1' : '0';
    record.tabSwitches = parseInt(vals[7] || 0, 10);
    record.points = (String(vals[8]).trim() === '') ? '' : Number(vals[8] || 0);
    record.status = (vals[9] === 'SOLVED') ? 'SOLVED' : '';
  }

  // Wrong attempts, tab switches and hint usage are recorded in BOTH cases.
  if (typeof data.wrongAttempts === 'number') record.wrongAttempts = Math.max(record.wrongAttempts, data.wrongAttempts);
  if (typeof data.tabSwitches === 'number') record.tabSwitches = Math.max(record.tabSwitches, data.tabSwitches);
  if (isHintFlag(data.hintUsed) || (typeof data.hintsUsed === 'number' && data.hintsUsed > 0)) record.hintUsed = '1';

  if (action === 'SOLVED') {
    // Repeat solves get their own distinguishable status so the admin panel
    // can render them differently and the sheet is self-documenting.
    record.status = isRepeatSolve ? 'REPEAT_SOLVE' : 'SOLVED';
    record.timestamp = timestamp;
    record.mission = record.mission || ('L' + (data.puzzleLevel || 1) + '_PUZZLE_' + puzzleId);

    // The local game computes points; this endpoint only writes the event.
    var deltaPoints = Number(data.points || 0);
    record.points = (String(record.points).trim() === '') ? 0 : Number(record.points);
    record.points += deltaPoints;

    if (ctx) {
      if (!isRepeatSolve && ctx.solved.indexOf(puzzleId) === -1) ctx.solved.push(puzzleId);
      ctx.points = Number(ctx.points || 0) + deltaPoints;
      ctx.lastDelta = deltaPoints;
      ctx.lastRepeat = isRepeatSolve;
      record.totalScore = (data.totalScore !== undefined) ? Number(data.totalScore) : ctx.points;
      record.unlockedPuzzles = Array.isArray(data.unlockedPuzzles)
        ? uniqueNumbers(data.unlockedPuzzles).join(',')
        : computeAllowedFromSolved(ctx.solved).join(',');
      record.solvedPuzzles = Array.isArray(data.solvedPuzzles)
        ? uniqueNumbers(data.solvedPuzzles).join(',')
        : uniqueNumbers(ctx.solved).join(',');
    } else {
      record.totalScore = 0;
      record.unlockedPuzzles = computeAllowedFromSolved([puzzleId]).join(',');
      record.solvedPuzzles = String(puzzleId);
    }
  } else {
    // Mid-way exit: row recorded with the exit timestamp (so we have a
    // record of when they went out); status & points stay EMPTY, and
    // score + queues are NOT recorded.
    record.status = '';
    record.points = '';
    record.timestamp = timestamp;
    record.totalScore = '';
    record.unlockedPuzzles = '';
    record.solvedPuzzles = '';
  }

  var rowArray = [
    safeCell(record.tid),
    safeCell(record.teamName),
    safeCell(record.mission),
    record.puzzleId,
    record.wrongAttempts,
    record.timestamp,
    record.hintUsed,
    record.tabSwitches,
    record.points,
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

function findTeamRow(rows, teamName, tid) {
  var tName = cellText_(teamName).toUpperCase();
  var tId = cellText_(tid).toUpperCase();

  for (var i = 1; i < rows.length; i++) {
    if (!rows[i] || rows[i].length < 3) continue;
    var rowTid = cellText_(rows[i][1]).toUpperCase();
    var rowTeam = cellText_(rows[i][2]).toUpperCase();
    if ((tId && rowTid === tId) || (tName && rowTeam === tName)) {
      return i + 1;
    }
  }
  return -1;
}

function findPuzzleRow(rows, teamName, tid, puzzleId, nullPuzzleMatch) {
  var tName = cellText_(teamName).toUpperCase();
  var tId = cellText_(tid).toUpperCase();

  for (var i = 1; i < rows.length; i++) {
    if (!rows[i] || rows[i].length < 2) continue;
    var rowTid = cellText_(rows[i][0]).toUpperCase();
    var rowTeam = cellText_(rows[i][1]).toUpperCase();

    var teamMatches = (tId && rowTid === tId) || (tName && rowTeam === tName);

    if (teamMatches) {
      // REPEAT_SOLVE rows are permanent standalone records; they must NEVER be
      // matched as the "existing" anchor row — otherwise a third repeat would
      // overwrite the second repeat row instead of creating a new one.
      var rowStatus = String(rows[i][9] || '');
      if (rowStatus === 'REPEAT_SOLVE') continue;

      var rowPid = rows[i][3];
      var rowHasPid = rowPid !== '' && rowPid !== null && !isNaN(rowPid);
      if (puzzleId) {
        if (rowHasPid && Number(rowPid) === Number(puzzleId)) return i + 1;
      } else if (nullPuzzleMatch && !rowHasPid) {
        return i + 1;
      }
    }
  }
  return -1;
}

function writeRow(sheet, rows, rowIdx) {
  if (rowIdx <= 0 || !rows[rowIdx - 1]) return;
  var maxRows = sheet.getMaxRows();
  if (rowIdx > maxRows) {
    sheet.insertRowsAfter(maxRows, rowIdx - maxRows);
  }
  var rowData = rows[rowIdx - 1];
  sheet.getRange(rowIdx, 1, 1, rowData.length).setValues([rowData]);
}

function parseIdList(text) {
  if (!text) return [];
  return String(text)
    .split(/[,\s]+/)
    .map(function(s) { return parseInt(s, 10); })
    .filter(function(n) { return !isNaN(n); });
}

function uniqueNumbers(list) {
  var seen = {};
  var out = [];
  (list || []).forEach(function(n) {
    n = Number(n);
    if (!isNaN(n) && !seen[n]) { seen[n] = true; out.push(n); }
  });
  return out;
}

function ensureSheetsExist(ss) {
  if (!ss) return;
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

    // Auto-delete extra trailing columns
    if (sheet.getMaxColumns() > t.headers.length) {
      sheet.deleteColumns(t.headers.length + 1, sheet.getMaxColumns() - t.headers.length);
    }
  });
}

function getAdminData_() {
  var ss = getSpreadsheet_();
  if (!ss) {
    Logger.log('Could not connect to Google Spreadsheet.');
    return [];
  }
  ensureSheetsExist(ss);
  var list = [];

  var regSheet = ss.getSheetByName('Registration');
  var regData = regSheet ? regSheet.getDataRange().getValues() : [];
  for (var i = 1; i < regData.length; i++) {
    var row = regData[i];
    if (!row || !row[1] && !row[2]) continue;
    list.push({
      isSummary: true,
      action: 'REGISTRATION',
      registered: true,
      registeredAt: row[0] || '',
      tid: row[1] || '',
      teamName: row[2] || '',
      mission: row[3] || '',
      language: row[4] || 'PYTHON',
      level: row[5] || '1',
      sessionId: row[6] || ''
    });
  }

  ['L1', 'L2', 'L3'].forEach(function(sheetName) {
    var sheet = ss.getSheetByName(sheetName);
    var rows = sheet ? sheet.getDataRange().getValues() : [];
    for (var j = 1; j < rows.length; j++) {
      var r = rows[j];
      if (!r || !r[0] && !r[1]) continue;
      var pid = parseInt(r[3] || 0, 10);
      list.push({
        isSummary: true,
        action: 'SUMMARY',
        tid: r[0] || '',
        teamName: r[1] || '',
        mission: r[2] || '',
        level: sheetName,
        puzzleId: pid || 0,
        wrongAttempts: parseInt(r[4] || 0, 10),
        timestamp: r[5] || '',
        hintUsed: isHintFlag(r[6]),
        tabSwitches: parseInt(r[7] || 0, 10),
        points: parseFloat(r[8] || 0),
        status: r[9] || '',
        totalScore: parseFloat(r[10] || 0),
        unlockedPuzzles: r[11] || '',
        solvedPuzzles: r[12] || ''
      });
    }
  });
  return list;
}

function doGet(e) {
  try {
    var params = (e && e.parameter) || {};

    if (params.action === 'ADMIN_GET_DATA') {
      return jsonResponse_(getAdminData_());
    }

    if (params.action === 'GET_EPOCH') {
      var epoch = parseInt(CacheService.getScriptCache().get('gameEpoch') || '0', 10);
      return jsonResponse_({ epoch: epoch });
    }

    return jsonResponse_(getAdminData_());
  } catch (err) {
    return jsonResponse_({ error: true, message: err.toString() });
  }
}
