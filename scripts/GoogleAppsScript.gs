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

function getSpreadsheet_() {
  var id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  if (id) return SpreadsheetApp.openById(id);
  return SpreadsheetApp.getActiveSpreadsheet();
}

var TEAM_RATE_LIMIT = 90;
var TEAM_RATE_WINDOW_SECS = 60;

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
  "Wrong Attempts", "Solve Time", "Hint Used", "Tab Switches",
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
  var lockAcquired = lock.tryLock(20000);

  try {
    if (!lockAcquired) {
      return ContentService.createTextOutput(JSON.stringify({ status: "error", message: "lock unavailable" }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    var ss = getSpreadsheet_();
    ensureSheetsExist(ss);

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

    if (data.action === 'GET_TEAM_STATE') {
      var qTid = (data.tid || '').toString().trim();
      var solved = [];
      var currentPuzzle = null;
      var unlocked = [];
      var score = 0;
      var hintsUsed = [];
      var latestScoreTimestamp = -1;

      ['L1', 'L2', 'L3'].forEach(function(name) {
        var sheet = ss.getSheetByName(name);
        if (!sheet) return;
        var rows = sheet.getDataRange().getValues();
        for (var i = 1; i < rows.length; i++) {
          if (rows[i][0] && String(rows[i][0]).trim().toUpperCase() === qTid.toUpperCase()) {
            var pid = Number(rows[i][3] || 0);
            if (pid > 0) {
              if (rows[i][9] === 'SOLVED') solved.push(pid);
              if (isHintFlag(rows[i][6])) hintsUsed.push(pid);
              currentPuzzle = pid;
            }
            unlocked = unlocked.concat(parseIdList(rows[i][11]));
            solved = solved.concat(parseIdList(rows[i][12]));
            var rowTimestamp = new Date(rows[i][5]).getTime();
            if (isNaN(rowTimestamp)) rowTimestamp = 0;
            if (rowTimestamp >= latestScoreTimestamp) {
              latestScoreTimestamp = rowTimestamp;
              score = Number(rows[i][10] || 0);
            }
          }
        }
      });
      solved = uniqueNumbers(solved);
      unlocked = uniqueNumbers(unlocked);
      hintsUsed = uniqueNumbers(hintsUsed);

      return ContentService.createTextOutput(JSON.stringify({
        status: 'success',
        solved: solved,
        currentPuzzle: currentPuzzle,
        unlocked: unlocked,
        hintsUsed: hintsUsed,
        score: score
      })).setMimeType(ContentService.MimeType.JSON);
    }

    if (!checkTeamRate(data.tid || data.teamName || '')) {
      return ContentService.createTextOutput(JSON.stringify({ status: "success", rateLimited: true }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    if (data.action === 'SESSION_BATCH' && Array.isArray(data.events)) {
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
  var rowIdx = applyEvent(rows, data);
  if (rowIdx > 0) {
    writeRow(sheet, rows, rowIdx);
    markEventProcessed(data.eventId);
  }
}

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

function applyRegistrationRow(rows, teamName, tid, data, timestamp) {
  var rowIdx = findTeamRow(rows, teamName, tid);
  var rowArray = [
    timestamp,
    tid,
    teamName,
    data.mission || '',
    data.language || '',
    data.level || '',
    data.sessionId || ''
  ];

  if (rowIdx > 0) {
    var existing = rows[rowIdx - 1];
    existing[0] = existing[0] || timestamp;
    existing[1] = tid || existing[1];
    existing[2] = teamName || existing[2];
    existing[3] = data.mission || existing[3];
    existing[4] = data.language || existing[4];
    existing[5] = data.level || existing[5];
    existing[6] = data.sessionId || existing[6];
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

function applyLevelRow(rows, teamName, tid, mission, action, data, timestamp) {
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

  // ──────────────────────────────────────────────────────────────
  // SNAPSHOT MODEL — a team+puzzle row is written EXACTLY ONCE.
  //
  // Intermediate events (wrong attempts, hints, penalties) are collected in
  // the client's per-puzzle notebook and only arrive here as ONE terminal
  // event:
  //   • SOLVED           -> final record (status SOLVED, points, solve time)
  //   • PUZZLE_ABANDONED -> half-info record for a mid-way exit (UNSOLVED,
  //                         empty points)
  // Non-terminal events never create or modify rows. This keeps status on
  // BOTH the Google Sheet and the admin panel strictly SOLVED / UNSOLVED
  // with no points while unsolved, and a row never changes after it has
  // been written once.
  // ──────────────────────────────────────────────────────────────

  var existingStatus = (rowIdx > 0) ? String(rows[rowIdx - 1][9] || '') : '';

  // Ignore every non-terminal action (no row creation, no updates).
  if (action !== 'SOLVED' && action !== 'PUZZLE_ABANDONED') return -1;

  // 🔒 SOLVED rows are sealed forever.
  if (existingStatus === 'SOLVED') return -1;

  // Already recorded as UNSOLVED (mid-way exit recorded once). Only a later
  // SOLVED may upgrade that row; nothing may keep churning it.
  if (existingStatus !== '' && action !== 'SOLVED') return -1;

  var record = {
    tid: tid || '',
    teamName: teamName,
    mission: mission,
    puzzleId: puzzleId,
    wrongAttempts: 0,
    solveTime: '',
    hintUsed: '0',
    tabSwitches: 0,
    points: '',   // UNSOLVED rows get EMPTY points
    status: 'UNSOLVED', // Default: answer not given yet
    totalScore: 0,
    unlockedPuzzles: '',
    solvedPuzzles: ''
  };

  if (!isNewPuzzle && rowIdx > 0) {
    var vals = rows[rowIdx - 1];
    record.tid = tid || vals[0];
    record.teamName = vals[1] || teamName;
    record.mission = mission || vals[2] || '';
    record.puzzleId = Number(vals[3] || puzzleId || 0);
    record.wrongAttempts = parseInt(vals[4] || 0, 10);
    record.solveTime = vals[5] || '';
    record.hintUsed = isHintFlag(vals[6]) ? '1' : '0';
    record.tabSwitches = parseInt(vals[7] || 0, 10);
    record.points = Number(vals[8] || 0);
    record.status = (vals[9] === 'SOLVED') ? 'SOLVED' : 'UNSOLVED';
    record.totalScore = Number(vals[10] || 0);
    record.unlockedPuzzles = vals[11] || '';
    record.solvedPuzzles = vals[12] || '';
  }

  // STATUS RULE: exactly SOLVED or UNSOLVED.
  if (action === 'SOLVED') {
    record.status = 'SOLVED';
    record.solveTime = timestamp;
    record.points = Number(record.points || 0);

    var deltaPoints = Number(data.points != null ? data.points : (data.pointsEarned || 0) - (data.pointsLost || 0));
    if (isNaN(deltaPoints)) deltaPoints = 0;
    record.points += deltaPoints;

    if (typeof data.wrongAttempts === 'number') record.wrongAttempts = Math.max(record.wrongAttempts, data.wrongAttempts);
    if (typeof data.tabSwitches === 'number') record.tabSwitches = Math.max(record.tabSwitches, data.tabSwitches);
    if (isHintFlag(data.hintUsed) || (typeof data.hintsUsed === 'number' && data.hintsUsed > 0)) record.hintUsed = '1';

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

  } else {
    // Answer not given yet — mid-way exit snapshot (half info).
    record.status = 'UNSOLVED';
    record.points = '';   // UNSOLVED => no points, empty cell
    record.solveTime = '';

    if (typeof data.wrongAttempts === 'number') record.wrongAttempts = Math.max(record.wrongAttempts, data.wrongAttempts);
    if (isHintFlag(data.hintUsed) || (typeof data.hintsUsed === 'number' && data.hintsUsed > 0)) record.hintUsed = '1';
    if (typeof data.tabSwitches === 'number') record.tabSwitches = Math.max(record.tabSwitches, data.tabSwitches);
  }

  var rowArray = [
    record.tid,
    record.teamName,
    record.mission,
    record.puzzleId,
    record.wrongAttempts,
    record.solveTime,
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
  var tName = String(teamName || '').trim().toUpperCase();
  var tId = String(tid || '').trim().toUpperCase();

  for (var i = 1; i < rows.length; i++) {
    var rowTid = String(rows[i][1] || '').trim().toUpperCase();
    var rowTeam = String(rows[i][2] || '').trim().toUpperCase();
    if ((tId && rowTid === tId) || (tName && rowTeam === tName)) {
      return i + 1;
    }
  }
  return -1;
}

function findPuzzleRow(rows, teamName, tid, puzzleId, nullPuzzleMatch) {
  var tName = String(teamName || '').trim().toUpperCase();
  var tId = String(tid || '').trim().toUpperCase();

  for (var i = 1; i < rows.length; i++) {
    var rowTid = String(rows[i][0] || '').trim().toUpperCase();
    var rowTeam = String(rows[i][1] || '').trim().toUpperCase();

    var teamMatches = (tId && rowTid === tId) || (tName && rowTeam === tName);

    if (teamMatches) {
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

function doGet(e) {
  try {
    var playerToken = getPlayerToken();
    if (!playerToken || !e.parameter.token || e.parameter.token !== playerToken) {
      return ContentService.createTextOutput(JSON.stringify({ error: true, message: "unauthorized" }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    if (e.parameter.action === 'GET_EPOCH') {
      var props = PropertiesService.getScriptProperties();
      var epoch = parseInt(props.getProperty('gameEpoch') || '0', 10);
      return ContentService.createTextOutput(JSON.stringify({ epoch: epoch }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    var ss = getSpreadsheet_();
    ensureSheetsExist(ss);

    var list = [];

    // Read Registration
    var regSheet = ss.getSheetByName("Registration");
    var regData = regSheet ? regSheet.getDataRange().getValues() : [];
    for (var i = 1; i < regData.length; i++) {
      list.push({
        isSummary: true,
        action: 'REGISTRATION',
        registered: true,
        registeredAt: regData[i][0],
        tid: regData[i][1],
        teamName: regData[i][2],
        mission: regData[i][3],
        language: regData[i][4],
        level: regData[i][5]
      });
    }

    // Read L1/L2/L3
    ['L1', 'L2', 'L3'].forEach(function(sheetName) {
      var sheet = ss.getSheetByName(sheetName);
      var rows = sheet ? sheet.getDataRange().getValues() : [];
      for (var j = 1; j < rows.length; j++) {
        var pid = parseInt(rows[j][3] || 0, 10);
        if (!pid) continue;
        list.push({
          isSummary: true,
          action: 'SUMMARY',
          tid: rows[j][0],
          teamName: rows[j][1],
          mission: rows[j][2],
          level: sheetName,
          puzzleId: pid,
          wrongAttempts: parseInt(rows[j][4] || 0, 10),
          solveTime: rows[j][5],
          hintUsed: isHintFlag(rows[j][6]),
          tabSwitches: parseInt(rows[j][7] || 0, 10),
          points: parseInt(rows[j][8] || 0, 10),
          status: rows[j][9],
          totalScore: parseInt(rows[j][10] || 0, 10),
          unlockedPuzzles: rows[j][11],
          solvedPuzzles: rows[j][12]
        });
      }
    });

    return ContentService.createTextOutput(JSON.stringify(list))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ error: true, message: err.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}