// =================================================================
// PYKACHU GO - MULTI-TAB (1-ROW-PER-TEAM PER SHEET) BACKEND
// =================================================================
// 4 Tabs in 1 Workbook: Registration, L1, L2, L3
// Each team gets ONLY 1 ROW per tab, updated in-place.
// Events are routed to the tab matching the PUZZLE's level: level 1 -> L1,
// level 2 -> L2, level 3 -> L3 (falls back to the team's registered mission
// level when no puzzle level is known). Registration events go only to the
// Registration tab. All 3 level tabs share one schema and carry the unlock
// queue (Current Puzzle ID + Unlocked Puzzle IDs) + Total Score, so there is
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

var ACCESS_TOKEN = 'pyk2026@secGX42';

// Registration tab schema (8 cols). Level = numeric mission level (1/2/3).
// Password is stored only because the event owner asked for it — never exposed
// through doGet (see doGet, password column is skipped).
var REG_HEADERS = [
  "Registration Time", "TID", "Team Name", "Mission", "Language",
  "Password", "Level", "Session ID"
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
  "Unlocked Puzzle IDs"
];

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

    var data = JSON.parse(e.postData.contents);

    if (!data.token || data.token !== ACCESS_TOKEN) {
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
      ['L1', 'L2', 'L3'].forEach(function(name) {
        var sheet = ss.getSheetByName(name);
        if (!sheet) return;
        var rows = sheet.getDataRange().getValues();
        for (var i = 1; i < rows.length; i++) {
          if (rows[i][1] && String(rows[i][1]).trim().toUpperCase() === qTid.toUpperCase()) {
            var pid = Number(rows[i][4] || 0);
            if (pid > 0) {
              solved.push(pid);
              currentPuzzle = pid; // rows appended chronologically → last wins
            }
            unlocked = unlocked.concat(parseIdList(rows[i][13]));
            score = Math.max(score, Number(rows[i][12] || 0));
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
    if (data.action === 'RESET_ALL') {
      var sheetsToWipe = ['Registration', 'L1', 'L2', 'L3'];
      sheetsToWipe.forEach(function(name) {
        var sheet = ss.getSheetByName(name);
        if (sheet && sheet.getLastRow() > 1) {
          sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).clearContent();
        }
      });
      var props = PropertiesService.getScriptProperties();
      var epoch = parseInt(props.getProperty('gameEpoch') || '0', 10) + 1;
      props.setProperty('gameEpoch', epoch.toString());
      SpreadsheetApp.flush();
      return ContentService.createTextOutput(JSON.stringify({ status: "success", epoch: epoch }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    if (data.action === 'SESSION_BATCH' && Array.isArray(data.events)) {
      data.events.forEach(function(event) { processEvent(ss, event); });
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

function processEvent(ss, data) {
  var action = data.action || '';
  if (action.indexOf('MEME') !== -1) return;

  var timestamp = data.timestamp || new Date().toISOString();
  var teamName = (data.teamName || data.team || '').toString().trim();
  if (!teamName || teamName === 'Unknown' || teamName === 'NO TEAM') return;

  var tid = (data.tid || '').toString().trim();
  var mission = (data.mission || '').toString();

  // 1. REGISTRATION TAB only (never a level tab)
  if (action === 'REGISTRATION') {
    var regSheet = ss.getSheetByName("Registration");
    updateRegistrationRow(regSheet, teamName, tid, data, timestamp);
    return;
  }

  // 2. TEAM STATE: no separate tab — current puzzle id, the unlock queue and
  //    the running score are all written straight into the team's L1/L2/L3 row
  //    inside updateLevelRow (SOLVED branch).

  // Ignore non-game-step telemetry (SESSION_START, CONNECTION_TEST, PROMISE_REJECTION, ...)
  if (GAME_STEP_ACTIONS.indexOf(action) === -1) return;

  // 2. Route by the PUZZLE's level (L1/L2/L3) so each puzzle's data lands in
  //    the sheet matching its level. Falls back to the team's registered
  //    mission level when no puzzle level is present.
  var level = '';
  if (data.puzzleLevel == 1 || data.puzzleLevel === '1') level = 'L1';
  else if (data.puzzleLevel == 2 || data.puzzleLevel === '2') level = 'L2';
  else if (data.puzzleLevel == 3 || data.puzzleLevel === '3') level = 'L3';

  if (!level) {
    var m = mission.split('_')[0].toUpperCase();
    if (m === 'L1' || m === 'L2' || m === 'L3') level = m;
  }
  if (!level) return;

  var sheet = ss.getSheetByName(level);
  updateLevelRow(sheet, teamName, tid, mission, action, data, timestamp);
}

// Update Registration Sheet Row (8 cols: REG_HEADERS order)
function updateRegistrationRow(sheet, teamName, tid, data, timestamp) {
  var rowIdx = findTeamRow(sheet, teamName);
  var rowArray = [
    timestamp,
    tid,
    teamName,
    data.mission || '',
    data.language || '',
    data.password || '',
    data.level || '',
    data.sessionId || ''
  ];
  if (rowIdx > 0) {
    sheet.getRange(rowIdx, 1, 1, 8).setValues([rowArray]);
  } else {
    sheet.appendRow(rowArray);
  }
}

// Per-PUZZLE row updater for L1/L2/L3 tabs. One row per (team, puzzle):
// a fresh row is appended for each new puzzle, and only THAT row is updated
// while the puzzle is in progress. Past records are frozen once a puzzle is
// solved or abandoned.
function updateLevelRow(sheet, teamName, tid, mission, action, data, timestamp) {
  // LEVEL_HEADERS:
  //  0 Last Active · 1 TID · 2 Team Name · 3 Mission · 4 Puzzle ID
  //  5 Wrong Attempts · 6 Solve Time · 7 Hint Used · 8 Tab Switches
  //  9 Points Earned · 10 Points Lost · 11 Status · 12 Total Score
  //  13 Unlocked Puzzle IDs
  var puzzleId = Number(data.puzzleId);
  if (isNaN(puzzleId) || puzzleId < 0) puzzleId = 0;

  // Locate this team's row for THIS puzzle; if unknown id, fall back to the
  // team's open (empty-id) row, else append a new one.
  var rowIdx = findPuzzleRow(sheet, teamName, puzzleId);
  var isNewPuzzle = false;
  if (rowIdx === -1) {
    if (puzzleId > 0) {
      rowIdx = findPuzzleRow(sheet, teamName, 0, true);
      if (rowIdx === -1) {
        rowIdx = sheet.getLastRow() + 1;
        isNewPuzzle = true;
      }
    } else {
      rowIdx = sheet.getLastRow() + 1;
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
    unlockedPuzzles: ''
  };

  if (!isNewPuzzle) {
    var vals = sheet.getRange(rowIdx, 1, 1, 14).getValues()[0];
    record.tid = tid || vals[1];
    record.teamName = vals[2] || teamName;
    record.mission = mission || vals[3] || '';
    record.puzzleId = Number(vals[4] || puzzleId || 0);
    record.wrongAttempts = parseInt(vals[5] || 0);
    record.solveTime = vals[6] || '';
    record.hintUsed = vals[7] || '0';
    record.tabSwitches = parseInt(vals[8] || 0);
    record.pointsEarned = Number(vals[9] || 0);
    record.pointsLost = Number(vals[10] || 0);
    record.status = vals[11] || 'ACTIVE';
    record.totalScore = Number(vals[12] || 0);
    record.unlockedPuzzles = vals[13] || '';
  } else {
    record.tid = tid || '';
    record.puzzleId = puzzleId;
  }

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
    record.totalScore = Math.max(record.totalScore, Number(data.score || 0));
  } else if (action === 'PUZZLE_ABANDONED') {
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
    record.unlockedPuzzles
  ];

  if (rowIdx <= sheet.getLastRow()) {
    sheet.getRange(rowIdx, 1, 1, 14).setValues([rowArray]);
  } else {
    sheet.appendRow(rowArray);
  }
}

function findTeamRow(sheet, teamName) {
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (data[i][2] && data[i][2].toString().trim().toUpperCase() === teamName.toUpperCase()) {
      return i + 1;
    }
  }
  return -1;
}

// One row per (team, puzzle). Row key = Team Name (col 2) + Puzzle ID (col 4).
// nullPuzzleMatch = also allow rows whose Puzzle ID is empty (unknown id).
function findPuzzleRow(sheet, teamName, puzzleId, nullPuzzleMatch) {
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (data[i][2] && data[i][2].toString().trim().toUpperCase() === teamName.toUpperCase()) {
      var rowPid = data[i][4];
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
    var headerRange = sheet.getRange(1, 1, 1, t.headers.length);
    headerRange.setValues([t.headers]);
    headerRange.setFontWeight("bold").setBackground("#1e293b").setFontColor("#ffffff");
  });
}

// Serves clean aggregated JSON data to the Admin Dashboard
function doGet(e) {
  try {
    if (!e.parameter.token || e.parameter.token !== ACCESS_TOKEN) {
      return ContentService.createTextOutput(JSON.stringify({ error: true, message: "unauthorized" }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    ensureSheetsExist(ss);

    // ── Clients check the epoch on load to wipe stale local progress ──
    if (e.parameter.action === 'GET_EPOCH') {
      var props = PropertiesService.getScriptProperties();
      var epoch = parseInt(props.getProperty('gameEpoch') || '0', 10);
      return ContentService.createTextOutput(JSON.stringify({ epoch: epoch }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    var list = [];

    // 1. Read Registration (password column is intentionally NOT exposed)
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
        list.push({
          isSummary: true,
          action: 'SUMMARY',
          lastActive: rows[j][0],
          tid: rows[j][1],
          teamName: rows[j][2],
          mission: rows[j][3],
          level: sheetName,
          puzzleId: parseInt(rows[j][4] || 0),
          wrongAttempts: parseInt(rows[j][5] || 0),
          solveTime: rows[j][6],
          hintUsed: rows[j][7] === '1',
          tabSwitches: parseInt(rows[j][8] || 0),
          pointsEarned: parseInt(rows[j][9] || 0),
          pointsLost: parseInt(rows[j][10] || 0),
          status: rows[j][11],
          totalScore: parseInt(rows[j][12] || 0),
          unlockedPuzzles: rows[j][13]
        });
      }
    });

    return ContentService.createTextOutput(JSON.stringify(list))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ error: true, message: err.toString() })).setMimeType(ContentService.MimeType.JSON);
  }
}
