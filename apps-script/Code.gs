/**
 * ============================================================================
 * PYKACHU GO v3.4 — HARDENED GOOGLE APPS SCRIPT TELEMETRY BACKEND
 * ============================================================================
 * Architecture:
 *   - Local JSON (`public/data/*.json`) serves static catalog & admin login.
 *   - This Apps Script persists live Registration, L1, L2, and L3 telemetry
 *     for 100+ concurrent teams × 40+ puzzles using O(1) single-row reads/writes,
 *     ScriptCache row indexing, session binding, and chunked admin snapshots.
 *
 * ONE-CLICK SETUP:
 *   1. Create a blank Google Sheet in Google Drive.
 *   2. Click Extensions → Apps Script.
 *   3. Replace all code in Code.gs with this file and save (Ctrl+S).
 *   4. In the function dropdown at the top, select `setupScriptProperties` and click "Run".
 *      (Approve the standard Google authorization prompt).
 *      All 4 tabs (Registration, L1, L2, L3) will be created and formatted instantly!
 *   5. Click Deploy → New deployment:
 *      - Select type: Web app (gear icon)
 *      - Description: Pykachu Go v3.4 Telemetry
 *      - Execute as: Me (<your-email>)
 *      - Who has access: Anyone
 *   6. Click Deploy, copy the Web App URL (ends with /exec), and paste into your project's .env:
 *      VITE_APPS_SCRIPT_URL="https://script.google.com/macros/s/.../exec"
 *
 * CUSTOM CONFIGURATION (Optional):
 * If you ever need to change settings, go to Project Settings → Script Properties:
 *   - SHEET_REG             : Tab name for registrations (default: Registration)
 *   - SHEET_L1              : Tab name for Level 1 telemetry (default: L1)
 *   - SHEET_L2              : Tab name for Level 2 telemetry (default: L2)
 *   - SHEET_L3              : Tab name for Level 3 telemetry (default: L3)
 *   - GAME_EPOCH            : Monotonic reset counter (default: 1)
 *   - TEAM_RATE_LIMIT       : Max requests per team per window (default: 90)
 *   - TEAM_RATE_WINDOW_SECS : Rate-limit window in seconds (default: 60)
 *   - CACHE_TTL_SECS        : Cache & event dedupe TTL seconds (default: 21600)
 *   - ADMIN_PASSWORD        : Secret matching admin.json (default: 123)
 *   - MAX_PUZZLE_POINTS     : Upper bound per puzzle solve (default: 500)
 *   - SPREADSHEET_ID        : Auto-populated from your Google Sheet ID
 * ============================================================================
 */

var PROP_KEYS = {
  SPREADSHEET_ID: 'SPREADSHEET_ID',
  SHEET_REG: 'SHEET_REG',
  SHEET_L1: 'SHEET_L1',
  SHEET_L2: 'SHEET_L2',
  SHEET_L3: 'SHEET_L3',
  GAME_EPOCH: 'GAME_EPOCH',
  TEAM_RATE_LIMIT: 'TEAM_RATE_LIMIT',
  TEAM_RATE_WINDOW_SECS: 'TEAM_RATE_WINDOW_SECS',
  CACHE_TTL_SECS: 'CACHE_TTL_SECS',
  ADMIN_PASSWORD: 'ADMIN_PASSWORD',
  MAX_PUZZLE_POINTS: 'MAX_PUZZLE_POINTS',
};

var DEFAULT_PROPERTIES = {
  SPREADSHEET_ID: '1XtDTCSSgMua_BmxAUhnUG7RZ9jfO3fxAL-vVoxmAY-k',
  SHEET_REG: 'Registration',
  SHEET_L1: 'L1',
  SHEET_L2: 'L2',
  SHEET_L3: 'L3',
  GAME_EPOCH: '1',
  TEAM_RATE_LIMIT: '90',
  TEAM_RATE_WINDOW_SECS: '60',
  CACHE_TTL_SECS: '21600',
  ADMIN_PASSWORD: '123',
  MAX_PUZZLE_POINTS: '500',
};

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
  'PUZZLE_ABANDONED',
];

// REGISTRATION HEADERS (7 cols)
var REG_HEADERS = [
  'Registration Time',
  'TID',
  'Team Name',
  'Mission',
  'Language',
  'Level',
  'Session ID',
];

// LEVEL HEADERS (13 cols)
var LEVEL_HEADERS = [
  'TID',
  'Team Name',
  'Mission',
  'Puzzle ID',
  'Wrong Attempts',
  'Timestamp',
  'Hint Used',
  'Tab Switches',
  'Points',
  'Status',
  'Total Score',
  'Unlocked Puzzle IDs',
  'Solved Puzzle IDs',
];

// ============================================================================
// CENTRALIZED SCRIPT PROPERTY LOADER (SELF-CONFIGURING WITH DEFAULTS)
// ============================================================================

function getConfig_() {
  var propService = PropertiesService.getScriptProperties();
  var props = propService.getProperties();
  var resolved = {};
  var needsPersist = {};

  for (var k in DEFAULT_PROPERTIES) {
    var raw = String(props[k] || '').trim();
    if (raw) {
      resolved[k] = raw;
    } else {
      resolved[k] = DEFAULT_PROPERTIES[k];
      needsPersist[k] = DEFAULT_PROPERTIES[k];
    }
  }

  var explicitId = String(
    props[PROP_KEYS.SPREADSHEET_ID] ||
      resolved[PROP_KEYS.SPREADSHEET_ID] ||
      ''
  ).trim();
  if (!explicitId) {
    var activeSs = SpreadsheetApp.getActiveSpreadsheet();
    if (activeSs) {
      explicitId = activeSs.getId();
      needsPersist[PROP_KEYS.SPREADSHEET_ID] = explicitId;
    }
  }

  if (Object.keys(needsPersist).length > 0) {
    try {
      propService.setProperties(needsPersist);
    } catch (e) {
      // Best effort background persist
    }
  }

  var regSheet = resolved[PROP_KEYS.SHEET_REG];
  var l1Sheet = resolved[PROP_KEYS.SHEET_L1];
  var l2Sheet = resolved[PROP_KEYS.SHEET_L2];
  var l3Sheet = resolved[PROP_KEYS.SHEET_L3];

  return {
    spreadsheetId: explicitId,
    sheets: {
      reg: regSheet,
      L1: l1Sheet,
      L2: l2Sheet,
      L3: l3Sheet,
    },
    levelTabs: [
      { levelKey: 'L1', sheetName: l1Sheet },
      { levelKey: 'L2', sheetName: l2Sheet },
      { levelKey: 'L3', sheetName: l3Sheet },
    ],
    epoch: Math.max(1, parseInt(resolved[PROP_KEYS.GAME_EPOCH], 10) || 1),
    teamRateLimit: Math.max(1, parseInt(resolved[PROP_KEYS.TEAM_RATE_LIMIT], 10) || 90),
    teamRateWindowSecs: Math.max(1, parseInt(resolved[PROP_KEYS.TEAM_RATE_WINDOW_SECS], 10) || 60),
    cacheTtlSecs: Math.min(21600, Math.max(30, parseInt(resolved[PROP_KEYS.CACHE_TTL_SECS], 10) || 21600)),
    adminPassword: resolved[PROP_KEYS.ADMIN_PASSWORD],
    maxPuzzlePoints: Math.min(100000, Math.max(1, parseInt(resolved[PROP_KEYS.MAX_PUZZLE_POINTS], 10) || 500)),
  };
}

function getSpreadsheet_(cfg) {
  if (cfg.spreadsheetId) {
    return SpreadsheetApp.openById(cfg.spreadsheetId);
  }
  var active = SpreadsheetApp.getActiveSpreadsheet();
  if (active) {
    return active;
  }
  throw new Error(
    'Missing Script Property "SPREADSHEET_ID" and script is not bound to a Google Sheet.'
  );
}

/**
 * ONE-CLICK SETUP FUNCTION
 * Select this function in the Apps Script function dropdown and click "Run".
 * It auto-configures all Script Properties, captures the Spreadsheet ID,
 * creates and formats the 4 required tabs (Registration, L1, L2, L3),
 * and cleans up any blank default Sheet1.
 */
function setupScriptProperties() {
  var propService = PropertiesService.getScriptProperties();
  var existing = propService.getProperties();
  var toSet = {};

  for (var k in DEFAULT_PROPERTIES) {
    if (!existing[k] || !String(existing[k]).trim()) {
      toSet[k] = DEFAULT_PROPERTIES[k];
    }
  }

  var activeSs = SpreadsheetApp.getActiveSpreadsheet();
  if (activeSs && (!existing[PROP_KEYS.SPREADSHEET_ID] || !String(existing[PROP_KEYS.SPREADSHEET_ID]).trim())) {
    toSet[PROP_KEYS.SPREADSHEET_ID] = activeSs.getId();
  }

  if (Object.keys(toSet).length > 0) {
    propService.setProperties(toSet);
  }

  initializeSpreadsheet();
  Logger.log('✅ Pykachu Go setup complete! All properties & sheet tabs initialized.');
}

function initializeSpreadsheet() {
  var cfg = getConfig_();
  var ss = getSpreadsheet_(cfg);
  ensureSheetsExist(ss, cfg, true);
  invalidateAdminSnapshotCache_(cfg);
  Logger.log(
    'Pykachu Go initialized tabs: ' +
      [cfg.sheets.reg, cfg.sheets.L1, cfg.sheets.L2, cfg.sheets.L3].join(', ')
  );
}

// ============================================================================
// ADMIN AUTHENTICATION & BRUTE-FORCE BACKOFF
// ============================================================================

function constantTimeEquals_(a, b) {
  var sa = String(a || '');
  var sb = String(b || '');
  if (sa.length !== sb.length || sa.length === 0) return false;
  var diff = 0;
  for (var i = 0; i < sa.length; i++) {
    diff |= sa.charCodeAt(i) ^ sb.charCodeAt(i);
  }
  return diff === 0;
}

function assertAdmin_(cfg, candidateKey) {
  var cache = CacheService.getScriptCache();
  var failKey = 'admin_fail_' + cfg.epoch;
  var rawFails = Number(cache.get(failKey) || 0) || 0;
  var failLimit = Math.max(5, Math.floor(cfg.teamRateLimit / 3));
  if (rawFails >= failLimit) {
    throw new Error('Unauthorized: Admin access temporarily locked due to repeated failures.');
  }

  if (!constantTimeEquals_(String(candidateKey || '').trim(), cfg.adminPassword)) {
    try {
      cache.put(failKey, String(rawFails + 1), cfg.teamRateWindowSecs);
    } catch (e) {
      // ignore
    }
    throw new Error('Unauthorized: Invalid admin access key.');
  }
  if (rawFails > 0) {
    try {
      cache.remove(failKey);
    } catch (e) {
      // ignore
    }
  }
}

// ============================================================================
// SANITIZATION & INPUT BOUNDS
// ============================================================================

function cellText_(value) {
  var s = String(value == null ? '' : value).trim();
  return s.charAt(0) === "'" ? s.slice(1) : s;
}

function safeCell(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') return isFinite(value) ? value : 0;
  var s = String(value);
  // Neutralize formula / DDE / tab-prefixed injection vectors
  return /^[\t\r\n ]*[=+\-@]/.test(s) ? "'" + s : s;
}

function sanitizeId_(value, maxLen) {
  return String(value || '')
    .trim()
    .replace(/[^A-Za-z0-9_-]/g, '_')
    .replace(/^_+|_+$/g, '')
    .substring(0, maxLen || 32);
}

function clampInt_(value, minVal, maxVal) {
  var n = Math.floor(Number(value));
  if (isNaN(n)) return minVal;
  return Math.min(maxVal, Math.max(minVal, n));
}

function uniqueNumbers(list) {
  var seen = {};
  var out = [];
  (list || []).forEach(function (n) {
    var num = Math.floor(Number(n));
    if (!isNaN(num) && num > 0 && num <= 10000 && !seen[num]) {
      seen[num] = true;
      out.push(num);
    }
  });
  return out.sort(function (a, b) {
    return a - b;
  });
}

function isHintFlag(val) {
  if (val === true || val === 1 || val === '1') return true;
  if (typeof val !== 'string') return false;
  var v = val.trim().toLowerCase();
  return v === 'true' || v === 'yes' || v === 'y' || v === '1';
}

function getTeamIdentity_(data) {
  if (!data) return null;
  var tid = sanitizeId_(String(data.tid || '').toUpperCase(), 32);
  var teamName = String(data.teamName || data.team || '')
    .trim()
    .substring(0, 60);
  if (!tid && !teamName) return null;
  if (teamName === 'Unknown' || teamName === 'NO TEAM') return null;
  return { tid: tid, teamName: teamName };
}

function teamRowMatches(row, tidIndex, teamIndex, tid, teamName) {
  if (!row || row.length <= Math.max(tidIndex, teamIndex)) return false;
  var tId = cellText_(tid).toUpperCase();
  var tName = cellText_(teamName).toUpperCase();
  var rowTid = cellText_(row[tidIndex]).toUpperCase();
  var rowTeam = cellText_(row[teamIndex]).toUpperCase();
  return Boolean((tId && rowTid === tId) || (tName && rowTeam === tName));
}

function jsonResponse_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(
    ContentService.MimeType.JSON
  );
}

// ============================================================================
// SHEET INITIALIZATION & CHUNKED CACHE HELPERS
// ============================================================================

function ensureSheetsExist(ss, cfg, forceCheck) {
  if (!ss) return;
  var cache = CacheService.getScriptCache();
  var readyKey = 'sheets_ready_' + cfg.epoch;
  if (!forceCheck && cache.get(readyKey) === '1') {
    return;
  }

  var tabs = [
    { name: cfg.sheets.reg, headers: REG_HEADERS },
    { name: cfg.sheets.L1, headers: LEVEL_HEADERS },
    { name: cfg.sheets.L2, headers: LEVEL_HEADERS },
    { name: cfg.sheets.L3, headers: LEVEL_HEADERS },
  ];

  tabs.forEach(function (t) {
    var sheet = ss.getSheetByName(t.name);
    if (!sheet) {
      sheet = ss.insertSheet(t.name);
    }
    if (sheet.getMaxColumns() < t.headers.length) {
      sheet.insertColumnsAfter(
        sheet.getMaxColumns(),
        t.headers.length - sheet.getMaxColumns()
      );
    }
    if (sheet.getLastRow() <= 0) {
      var headerRange = sheet.getRange(1, 1, 1, t.headers.length);
      headerRange.setValues([t.headers]);
      headerRange.setFontWeight('bold').setBackground('#1e293b').setFontColor('#ffffff');
      sheet.setFrozenRows(1);
    }
    if (sheet.getMaxColumns() > t.headers.length) {
      sheet.deleteColumns(
        t.headers.length + 1,
        sheet.getMaxColumns() - t.headers.length
      );
    }
  });

  // Remove empty default 'Sheet1' if our configured tabs are ready
  try {
    var defaultSheet =
      ss.getSheetByName('Sheet1') ||
      ss.getSheetByName('Feuille 1') ||
      ss.getSheetByName('Hoja 1');
    if (defaultSheet && defaultSheet.getLastRow() <= 1 && ss.getSheets().length > 1) {
      ss.deleteSheet(defaultSheet);
    }
  } catch (e) {
    // Non-fatal if default sheet cannot be deleted
  }

  try {
    cache.put(readyKey, '1', cfg.cacheTtlSecs);
  } catch (e) {
    // ignore
  }
}

function cachePutJson_(cacheKey, obj, ttlSecs) {
  try {
    var raw = JSON.stringify(obj);
    var CHUNK_LEN = 85000;
    var count = Math.ceil(raw.length / CHUNK_LEN) || 1;
    if (count > 25) return; // Exceeds reasonable cache size
    var chunks = {};
    for (var i = 0; i < count; i++) {
      chunks[cacheKey + '_' + i] = raw.slice(i * CHUNK_LEN, (i + 1) * CHUNK_LEN);
    }
    chunks[cacheKey + '_chunks'] = String(count);
    CacheService.getScriptCache().putAll(chunks, ttlSecs);
  } catch (e) {
    // Cache is best-effort
  }
}

function cacheGetJson_(cacheKey) {
  try {
    var cache = CacheService.getScriptCache();
    var countRaw = cache.get(cacheKey + '_chunks');
    if (!countRaw) return null;
    var count = Number(countRaw);
    if (!count || isNaN(count) || count > 25) return null;
    var keys = [];
    for (var i = 0; i < count; i++) {
      keys.push(cacheKey + '_' + i);
    }
    var partsMap = cache.getAll(keys);
    var combined = '';
    for (var j = 0; j < count; j++) {
      var chunk = partsMap[cacheKey + '_' + j];
      if (chunk === undefined || chunk === null) return null;
      combined += chunk;
    }
    return JSON.parse(combined);
  } catch (e) {
    return null;
  }
}

function cacheRemoveJson_(cacheKey) {
  try {
    var cache = CacheService.getScriptCache();
    var keys = [cacheKey + '_chunks'];
    for (var i = 0; i < 25; i++) {
      keys.push(cacheKey + '_' + i);
    }
    cache.removeAll(keys);
  } catch (e) {
    // ignore
  }
}

function adminSnapshotCacheKey_(cfg) {
  return 'admin_snap_' + cfg.epoch;
}

function invalidateAdminSnapshotCache_(cfg) {
  cacheRemoveJson_(adminSnapshotCacheKey_(cfg));
}

// ============================================================================
// RATE LIMITING, DEDUPLICATION, SESSION & TEAM CONTEXT INDEX
// ============================================================================

function checkTeamRate(teamKey, cfg) {
  var key = String(teamKey || '').trim();
  if (!key || key === 'Unknown' || key === 'NO TEAM') return true;
  var cache = CacheService.getScriptCache();
  var bucketKey = 'rate_' + cfg.epoch + '_' + key.replace(/[^A-Za-z0-9_]/g, '_');
  var now = Math.floor(Date.now() / 1000);
  var bucket = [0, now];
  var raw = cache.get(bucketKey);
  if (raw) {
    try {
      bucket = JSON.parse(raw);
    } catch (e) {
      bucket = [0, now];
    }
  }
  if (now - Number(bucket[1]) > cfg.teamRateWindowSecs) {
    bucket = [0, now];
  }
  bucket[0] = Number(bucket[0] || 0) + 1;
  cache.put(bucketKey, JSON.stringify(bucket), cfg.teamRateWindowSecs + 1);
  return bucket[0] <= cfg.teamRateLimit;
}

function eventCacheKey_(eventId, cfg) {
  return (
    'evt_' +
    cfg.epoch +
    '_' +
    String(eventId).replace(/[^A-Za-z0-9_]/g, '_').substring(0, 190)
  );
}

function isDuplicateEvent(eventId, cfg) {
  if (!eventId) return false;
  try {
    return CacheService.getScriptCache().get(eventCacheKey_(eventId, cfg)) !== null;
  } catch (e) {
    return false;
  }
}

function markEventProcessed(eventId, cfg) {
  if (!eventId) return;
  try {
    CacheService.getScriptCache().put(
      eventCacheKey_(eventId, cfg),
      '1',
      cfg.cacheTtlSecs
    );
  } catch (e) {
    // ignore
  }
}

function regCacheKey_(tid, teamName, cfg) {
  var identity = String(tid || teamName || '')
    .toUpperCase()
    .replace(/[^A-Za-z0-9_]/g, '_')
    .substring(0, 180);
  return identity ? 'reg_' + cfg.epoch + '_' + identity : '';
}

function getRegisteredInfo_(ss, tid, teamName, cfg) {
  var rKey = regCacheKey_(tid, teamName, cfg);
  if (!rKey) return null;
  var cache = CacheService.getScriptCache();
  var cached = cache.get(rKey);
  if (cached) {
    try {
      return JSON.parse(cached);
    } catch (e) {
      // fall through
    }
  }

  var regSheet = ss.getSheetByName(cfg.sheets.reg);
  if (!regSheet || regSheet.getLastRow() <= 1) return null;
  var rows = regSheet
    .getRange(1, 1, regSheet.getLastRow(), REG_HEADERS.length)
    .getValues();
  for (var i = 1; i < rows.length; i++) {
    if (teamRowMatches(rows[i], 1, 2, tid, teamName)) {
      var info = { row: i + 1, sessionId: cellText_(rows[i][6]) };
      try {
        cache.put(rKey, JSON.stringify(info), cfg.cacheTtlSecs);
      } catch (e) {
        // ignore
      }
      return info;
    }
  }
  return null;
}

function setRegisteredInfoCache_(tid, teamName, rowIdx, sessionId, cfg) {
  var rKey = regCacheKey_(tid, teamName, cfg);
  if (!rKey) return;
  try {
    CacheService.getScriptCache().put(
      rKey,
      JSON.stringify({ row: rowIdx, sessionId: String(sessionId || '') }),
      cfg.cacheTtlSecs
    );
  } catch (e) {
    // ignore
  }
}

function invalidateTeamCaches_(tid, teamName, cfg) {
  try {
    var cache = CacheService.getScriptCache();
    var cKey = teamContextCacheKey_(tid, teamName, cfg);
    var rKey = regCacheKey_(tid, teamName, cfg);
    var toRemove = [];
    if (cKey) toRemove.push(cKey);
    if (rKey) toRemove.push(rKey);
    if (toRemove.length > 0) cache.removeAll(toRemove);
  } catch (e) {
    // ignore
  }
}

function teamContextCacheKey_(tid, teamName, cfg) {
  var identity = String(tid || teamName || '')
    .toUpperCase()
    .replace(/[^A-Za-z0-9_]/g, '_')
    .substring(0, 180);
  if (!identity) return '';
  return 'ctx_' + cfg.epoch + '_' + identity;
}

function cacheTeamContext_(tid, teamName, context, cfg) {
  var cKey = teamContextCacheKey_(tid, teamName, cfg);
  if (!cKey || !context) return;
  try {
    CacheService.getScriptCache().put(
      cKey,
      JSON.stringify(context),
      cfg.cacheTtlSecs
    );
  } catch (e) {
    Logger.log('Could not cache team context: ' + e);
  }
}

function getCachedTeamContext_(tid, teamName, cfg) {
  var cKey = teamContextCacheKey_(tid, teamName, cfg);
  if (!cKey) return null;
  try {
    var cached = CacheService.getScriptCache().get(cKey);
    return cached ? JSON.parse(cached) : null;
  } catch (e) {
    return null;
  }
}

function getTeamContext(ss, tid, teamName, cfg) {
  if (!ss) {
    return {
      solved: [],
      points: 0,
      hintsUsed: [],
      tabSwitches: 0,
      currentPuzzle: null,
      currentPuzzleTimestamp: -1,
      rowIndexes: {},
    };
  }
  var cached = getCachedTeamContext_(tid, teamName, cfg);
  if (cached) return cached;

  var solved = [];
  var points = 0;
  var hintsUsed = [];
  var totalTabSwitches = 0;
  var rowIndexes = {};
  var currentPuzzle = null;
  var latestPuzzleTimestamp = -1;

  cfg.levelTabs.forEach(function (tab) {
    var sheet = ss.getSheetByName(tab.sheetName);
    if (!sheet || sheet.getLastRow() <= 1) return;
    var rows = sheet.getDataRange().getValues();
    for (var i = 1; i < rows.length; i++) {
      if (
        !rows[i] ||
        rows[i].every(function (c) {
          return c === '' || c === null || c === undefined;
        })
      ) {
        continue;
      }
      if (!teamRowMatches(rows[i], 0, 1, tid, teamName)) continue;

      var status = cellText_(rows[i][9]);
      var pid = Number(rows[i][3] || 0);

      if (pid > 0 && status !== 'REPEAT_SOLVE' && !rowIndexes[pid]) {
        rowIndexes[pid] = { sheet: tab.sheetName, row: i + 1 };
      }

      if (status === 'SOLVED' || status === 'REPEAT_SOLVE') {
        if (pid > 0) solved.push(pid);
        points += Number(rows[i][8] || 0) || 0;
      }

      if (pid > 0 && isHintFlag(rows[i][6])) {
        hintsUsed.push(pid);
      }

      var rowTabs = Number(rows[i][7] || 0) || 0;
      if (rowTabs > 0) totalTabSwitches += rowTabs;

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
    tabSwitches: totalTabSwitches,
    currentPuzzle: currentPuzzle,
    currentPuzzleTimestamp: latestPuzzleTimestamp,
    rowIndexes: rowIndexes,
  };

  cacheTeamContext_(tid, teamName, result, cfg);
  return result;
}

function updateTeamContextForRow_(context, sheetName, rowIdx, rowArray) {
  if (!context || rowIdx <= 0 || !rowArray) return;
  var puzzleId = Number(rowArray[3] || 0);
  if (puzzleId <= 0) return;

  context.rowIndexes = context.rowIndexes || {};
  if (String(rowArray[9] || '') !== 'REPEAT_SOLVE' && !context.rowIndexes[puzzleId]) {
    context.rowIndexes[puzzleId] = { sheet: sheetName, row: rowIdx };
  }
  if (isHintFlag(rowArray[6]) && context.hintsUsed.indexOf(puzzleId) === -1) {
    context.hintsUsed.push(puzzleId);
  }
  var rowTimestamp = new Date(rowArray[5]).getTime();
  if (isNaN(rowTimestamp)) rowTimestamp = 0;
  if (rowTimestamp >= Number(context.currentPuzzleTimestamp || -1)) {
    context.currentPuzzle = puzzleId;
    context.currentPuzzleTimestamp = rowTimestamp;
  }
}

// ============================================================================
// HTTP ENTRYPOINTS (doOptions / doGet / doPost)
// ============================================================================

function doOptions() {
  return ContentService.createTextOutput('').setMimeType(
    ContentService.MimeType.TEXT
  );
}

function doGet(e) {
  try {
    var cfg = getConfig_();
    var params = (e && e.parameter) || {};

    // Direct browser hit / health check probe (no query action)
    if (!params.action) {
      return jsonResponse_({
        status: 'success',
        message: 'Pykachu Go Apps Script Backend is live and healthy!',
        epoch: cfg.epoch,
        version: '3.4',
        spreadsheetId: cfg.spreadsheetId
          ? cfg.spreadsheetId.substring(0, 8) + '...'
          : 'active',
      });
    }

    var action = String(params.action).trim().toUpperCase();

    if (action === 'GET_EPOCH' || action === 'GETMETA') {
      return jsonResponse_({
        status: 'success',
        epoch: cfg.epoch,
      });
    }

    if (action === 'GET_TEAM_STATE') {
      var ss = getSpreadsheet_(cfg);
      var stateSession = getTeamIdentity_(params);
      if (!stateSession) {
        return jsonResponse_({ status: 'error', message: 'login required' });
      }
      var ctx = getTeamContext(ss, stateSession.tid, stateSession.teamName, cfg);
      return jsonResponse_({
        status: 'success',
        epoch: cfg.epoch,
        solved: ctx.solved.slice(),
        unlocked: ctx.solved.slice(),
        hintsUsed: ctx.hintsUsed || [],
        tabSwitches: ctx.tabSwitches || 0,
        currentPuzzle: ctx.currentPuzzle || null,
        score: ctx.points,
      });
    }

    if (action === 'ADMIN_GET_DATA' || action === 'GETLOGS') {
      assertAdmin_(cfg, params.adminKey);
      return jsonResponse_(getAdminData_(cfg));
    }

    return jsonResponse_({
      status: 'error',
      message: 'Unknown GET action: ' + action,
    });
  } catch (err) {
    return jsonResponse_({
      status: 'error',
      message: err && err.message ? err.message : String(err),
    });
  }
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
      return jsonResponse_({ status: 'error', message: 'bad json' });
    }
    if (!data || typeof data !== 'object' || !data.action) {
      return jsonResponse_({ status: 'error', message: 'missing action' });
    }

    var cfg = getConfig_();
    var action = String(data.action).trim().toUpperCase();

    if (action === 'GET_EPOCH') {
      return jsonResponse_({ status: 'success', epoch: cfg.epoch });
    }

    if (action === 'ADMIN_AUTH') {
      assertAdmin_(cfg, data.adminKey || data.password);
      return jsonResponse_({ status: 'success', session: 'admin-verified' });
    }

    if (action === 'ADMIN_GET_DATA') {
      assertAdmin_(cfg, data.adminKey || data.password);
      return jsonResponse_(getAdminData_(cfg));
    }

    if (action === 'RESET_ALL') {
      assertAdmin_(cfg, data.adminKey || data.password);
      lockAcquired = lock.tryLock(30000);
      if (!lockAcquired) {
        return jsonResponse_({ status: 'error', message: 'lock unavailable' });
      }

      var resetSs = getSpreadsheet_(cfg);
      ensureSheetsExist(resetSs, cfg, true);

      cfg.levelTabs.forEach(function (tab) {
        var sheet = resetSs.getSheetByName(tab.sheetName);
        if (!sheet || sheet.getLastRow() <= 1) return;
        var values = sheet.getRange(2, 1, sheet.getLastRow() - 1, 2).getValues();
        for (var i = 0; i < values.length; i++) {
          invalidateTeamCaches_(values[i][0], values[i][1], cfg);
        }
      });

      [cfg.sheets.reg, cfg.sheets.L1, cfg.sheets.L2, cfg.sheets.L3].forEach(
        function (name) {
          var sheet = resetSs.getSheetByName(name);
          if (sheet && sheet.getLastRow() > 1) {
            sheet
              .getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn())
              .clearContent();
          }
        }
      );

      var nextEpoch = cfg.epoch + 1;
      PropertiesService.getScriptProperties().setProperty(
        PROP_KEYS.GAME_EPOCH,
        String(nextEpoch)
      );
      invalidateAdminSnapshotCache_(cfg);
      SpreadsheetApp.flush();
      return jsonResponse_({ status: 'success', epoch: nextEpoch });
    }

    var ss = getSpreadsheet_(cfg);

    if (action === 'GET_TEAM_STATE') {
      ensureSheetsExist(ss, cfg, false);
      var stateSession = getTeamIdentity_(data);
      if (!stateSession) {
        return jsonResponse_({ status: 'error', message: 'login required' });
      }
      var ctx = getTeamContext(ss, stateSession.tid, stateSession.teamName, cfg);
      return jsonResponse_({
        status: 'success',
        epoch: cfg.epoch,
        solved: ctx.solved.slice(),
        unlocked: ctx.solved.slice(),
        hintsUsed: ctx.hintsUsed || [],
        tabSwitches: ctx.tabSwitches || 0,
        currentPuzzle: ctx.currentPuzzle || null,
        score: ctx.points,
      });
    }

    // Write operations run serialized under ScriptLock
    lockAcquired = lock.tryLock(30000);
    if (!lockAcquired) {
      return jsonResponse_({ status: 'error', message: 'lock unavailable' });
    }

    ensureSheetsExist(ss, cfg, false);

    var writeSession = getTeamIdentity_(data);
    if (!writeSession) {
      return jsonResponse_({ status: 'error', message: 'login required' });
    }

    var rateKey = writeSession.tid || writeSession.teamName || '';
    if (!checkTeamRate(rateKey, cfg)) {
      return jsonResponse_({
        status: 'rate_limited',
        message: 'Team request limit reached',
        retryAfterSeconds: cfg.teamRateWindowSecs,
      });
    }

    var mutated = false;

    if (action === 'SESSION_BATCH' && Array.isArray(data.events)) {
      // Process REGISTRATION events first so session binding succeeds cleanly
      var orderedEvents = [];
      for (var r = 0; r < data.events.length; r++) {
        var evR = data.events[r];
        if (evR && String(evR.action || '').toUpperCase() === 'REGISTRATION') {
          orderedEvents.push(evR);
        }
      }
      for (var o = 0; o < data.events.length; o++) {
        var evO = data.events[o];
        if (evO && String(evO.action || '').toUpperCase() !== 'REGISTRATION') {
          orderedEvents.push(evO);
        }
      }

      for (var k = 0; k < orderedEvents.length; k++) {
        var ev = orderedEvents[k];
        ev.tid = writeSession.tid || sanitizeId_(String(ev.tid || '').toUpperCase(), 32);
        ev.teamName = writeSession.teamName || String(ev.teamName || '').trim().substring(0, 60);
        if (!ev.sessionId && data.sessionId) ev.sessionId = data.sessionId;
        if (processEventFast_(ss, ev, cfg)) {
          mutated = true;
        }
      }
    } else {
      data.tid = writeSession.tid;
      data.teamName = writeSession.teamName;
      var outcome = processEventFast_(ss, data, cfg);
      if (outcome === 'rejected_auth') {
        return jsonResponse_({
          status: 'error',
          message: 'Team session not registered or mismatched',
        });
      }
      mutated = Boolean(outcome);
    }

    if (mutated) {
      invalidateAdminSnapshotCache_(cfg);
      SpreadsheetApp.flush();
    }
    return jsonResponse_({ status: 'success', epoch: cfg.epoch });
  } catch (err) {
    return jsonResponse_({
      status: 'error',
      message: err && err.message ? err.message : String(err),
    });
  } finally {
    if (lockAcquired) {
      lock.releaseLock();
    }
  }
}

// ============================================================================
// O(1) SINGLE-ROW TELEMETRY PROCESSOR (100+ TEAMS × 40 PUZZLES)
// ============================================================================

function eventSheetLabel(data, cfg) {
  var action = String(data.action || '').trim().toUpperCase();
  if (action.indexOf('MEME') !== -1) return '';

  var teamName = String(data.teamName || data.team || '').trim();
  if (!teamName || teamName === 'Unknown' || teamName === 'NO TEAM') return '';

  if (action === 'REGISTRATION') return cfg.sheets.reg;
  if (GAME_STEP_ACTIONS.indexOf(action) === -1) return '';

  var rawLvl = String(data.puzzleLevel || data.level || '')
    .trim()
    .toUpperCase();
  if (rawLvl === '1' || rawLvl === 'L1') return cfg.sheets.L1;
  if (rawLvl === '2' || rawLvl === 'L2') return cfg.sheets.L2;
  if (rawLvl === '3' || rawLvl === 'L3') return cfg.sheets.L3;

  var mPrefix = String(data.mission || '')
    .split('_')[0]
    .toUpperCase();
  if (mPrefix === 'L1') return cfg.sheets.L1;
  if (mPrefix === 'L2') return cfg.sheets.L2;
  if (mPrefix === 'L3') return cfg.sheets.L3;
  return cfg.sheets.L1;
}

function processEventFast_(ss, data, cfg) {
  var action = String(data.action || '').trim().toUpperCase();
  var label = eventSheetLabel(data, cfg);
  if (!label) return false;
  if (isDuplicateEvent(data.eventId, cfg)) return false;

  var sheet = ss.getSheetByName(label);
  if (!sheet) return false;

  var timestamp = String(data.timestamp || new Date().toISOString()).substring(0, 40);
  var tid = sanitizeId_(String(data.tid || '').toUpperCase(), 32);
  var teamName = String(data.teamName || data.team || '').trim().substring(0, 60);
  var mission = String(data.mission || '').trim().substring(0, 40);
  var incomingSession = String(data.sessionId || '').trim().substring(0, 64);

  // ── 1. REGISTRATION: Direct O(1) row update/append + session bind ──────────
  if (action === 'REGISTRATION') {
    var regInfo = getRegisteredInfo_(ss, tid, teamName, cfg);
    var levelVal = safeCell(
      String(
        data.level ||
          (mission.split('_')[0].replace(/\D/g, '') || '1')
      ).substring(0, 8)
    );
    var regRowIdx = -1;
    var rowArray;

    if (regInfo && regInfo.row > 1 && regInfo.row <= sheet.getLastRow()) {
      var existing = sheet
        .getRange(regInfo.row, 1, 1, REG_HEADERS.length)
        .getValues()[0];
      if (teamRowMatches(existing, 1, 2, tid, teamName)) {
        regRowIdx = regInfo.row;
        rowArray = [
          existing[0] || timestamp,
          safeCell(tid) || existing[1],
          safeCell(teamName) || existing[2],
          safeCell(mission) || existing[3],
          safeCell(String(data.language || 'PYTHON').substring(0, 16)) || existing[4],
          levelVal || existing[5],
          safeCell(incomingSession) || existing[6],
        ];
      }
    }

    if (regRowIdx === -1) {
      regRowIdx = Math.max(2, sheet.getLastRow() + 1);
      rowArray = [
        timestamp,
        safeCell(tid),
        safeCell(teamName),
        safeCell(mission),
        safeCell(String(data.language || 'PYTHON').substring(0, 16)),
        levelVal,
        safeCell(incomingSession),
      ];
    }

    writeSingleRow_(sheet, regRowIdx, rowArray);
    setRegisteredInfoCache_(tid, teamName, regRowIdx, incomingSession, cfg);
    markEventProcessed(data.eventId, cfg);
    return true;
  }

  // ── 2. LEVEL EVENTS: Enforce session binding & O(1) targeted row upsert ──
  var regCheck = getRegisteredInfo_(ss, tid, teamName, cfg);
  if (!regCheck) {
    // Reject unauthenticated writes from unregistered teams
    return 'rejected_auth';
  }
  if (
    regCheck.sessionId &&
    incomingSession &&
    regCheck.sessionId !== incomingSession
  ) {
    // Reject stale / hijacked session writes
    return 'rejected_auth';
  }

  var puzzleId = clampInt_(data.puzzleId, 0, 10000);
  if (puzzleId <= 0) return false;
  if (action === 'SOLVED' && !isFinite(Number(data.points))) return false;

  var ctx = getTeamContext(ss, tid, teamName, cfg);
  var anchor = ctx.rowIndexes && ctx.rowIndexes[puzzleId];
  var targetRowIdx = -1;
  var existingRow = null;
  var isRepeatSolve = false;

  if (anchor && anchor.sheet === label && anchor.row > 1 && anchor.row <= sheet.getLastRow()) {
    var candidate = sheet
      .getRange(anchor.row, 1, 1, LEVEL_HEADERS.length)
      .getValues()[0];
    if (
      teamRowMatches(candidate, 0, 1, tid, teamName) &&
      Number(candidate[3]) === puzzleId &&
      cellText_(candidate[9]) !== 'REPEAT_SOLVE'
    ) {
      targetRowIdx = anchor.row;
      existingRow = candidate;
    }
  }

  var alreadySolved =
    (existingRow && cellText_(existingRow[9]) === 'SOLVED') ||
    (ctx.solved && ctx.solved.indexOf(puzzleId) !== -1);

  if (alreadySolved && action === 'SOLVED') {
    isRepeatSolve = true;
    targetRowIdx = -1;
    existingRow = null;
  }

  // Build next row state
  var wrongAttempts = existingRow ? parseInt(existingRow[4] || 0, 10) || 0 : 0;
  var tabSwitches = existingRow ? parseInt(existingRow[7] || 0, 10) || 0 : 0;
  var hintUsed = existingRow && isHintFlag(existingRow[6]) ? '1' : '0';

  if (typeof data.wrongAttempts === 'number') {
    wrongAttempts = Math.max(wrongAttempts, clampInt_(data.wrongAttempts, 0, 10000));
  }
  if (typeof data.attemptCount === 'number') {
    wrongAttempts = Math.max(wrongAttempts, clampInt_(data.attemptCount, 0, 10000));
  }
  if (typeof data.tabSwitches === 'number') {
    tabSwitches = Math.max(tabSwitches, clampInt_(data.tabSwitches, 0, 10000));
  }
  if (
    isHintFlag(data.hintUsed) ||
    (typeof data.hintsUsed === 'number' && data.hintsUsed > 0)
  ) {
    hintUsed = '1';
  }

  // Sealed SOLVED rows accept telemetry counter increments only; never downgrade status
  if (existingRow && cellText_(existingRow[9]) === 'SOLVED' && action !== 'SOLVED') {
    if (action === 'PUZZLE_ABANDONED') return false;
    var sealedRow = existingRow.slice();
    sealedRow[4] = wrongAttempts;
    sealedRow[6] = hintUsed;
    sealedRow[7] = tabSwitches;
    sealedRow[5] = timestamp;
    writeSingleRow_(sheet, targetRowIdx, sealedRow);
    updateTeamContextForRow_(ctx, label, targetRowIdx, sealedRow);
    cacheTeamContext_(tid, teamName, ctx, cfg);
    markEventProcessed(data.eventId, cfg);
    return true;
  }

  // Telemetry-only events (not SOLVED / PUZZLE_ABANDONED)
  if (action !== 'SOLVED' && action !== 'PUZZLE_ABANDONED') {
    var telMission =
      (existingRow && existingRow[2]) ||
      mission ||
      'L' + (data.puzzleLevel || 1) + '_PUZZLE_' + puzzleId;
    var telUnlocked = Array.isArray(data.unlockedPuzzles)
      ? uniqueNumbers(data.unlockedPuzzles).join(',')
      : (existingRow && cellText_(existingRow[11])) || '';
    var telRow = [
      safeCell(tid),
      safeCell(teamName),
      safeCell(telMission),
      puzzleId,
      wrongAttempts,
      timestamp,
      hintUsed,
      tabSwitches,
      existingRow ? existingRow[8] : '',
      existingRow ? existingRow[9] : '',
      existingRow && existingRow[10] !== '' ? existingRow[10] : ctx.points,
      safeCell(telUnlocked),
      existingRow ? existingRow[12] : '',
    ];
    if (targetRowIdx <= 0) {
      targetRowIdx = Math.max(2, sheet.getLastRow() + 1);
    }
    writeSingleRow_(sheet, targetRowIdx, telRow);
    updateTeamContextForRow_(ctx, label, targetRowIdx, telRow);
    cacheTeamContext_(tid, teamName, ctx, cfg);
    markEventProcessed(data.eventId, cfg);
    return true;
  }

  // PUZZLE_ABANDONED: never overwrite an existing row (unless blank)
  if (action === 'PUZZLE_ABANDONED') {
    var abMission =
      (existingRow && existingRow[2]) ||
      mission ||
      'L' + (data.puzzleLevel || 1) + '_PUZZLE_' + puzzleId;
    var abRow = [
      safeCell(tid),
      safeCell(teamName),
      safeCell(abMission),
      puzzleId,
      wrongAttempts,
      timestamp,
      hintUsed,
      tabSwitches,
      '',
      '',
      '',
      '',
      '',
    ];
    if (targetRowIdx <= 0) {
      targetRowIdx = Math.max(2, sheet.getLastRow() + 1);
    }
    writeSingleRow_(sheet, targetRowIdx, abRow);
    updateTeamContextForRow_(ctx, label, targetRowIdx, abRow);
    cacheTeamContext_(tid, teamName, ctx, cfg);
    markEventProcessed(data.eventId, cfg);
    return true;
  }

  // SOLVED (initial or REPEAT_SOLVE) — server-bounded points & authoritative totalScore
  var rawDelta = Number(data.points || 0);
  var deltaPoints = isRepeatSolve
    ? Math.max(-cfg.maxPuzzlePoints, Math.min(0, rawDelta))
    : Math.max(0, Math.min(cfg.maxPuzzlePoints, rawDelta));

  if (!isRepeatSolve && ctx.solved.indexOf(puzzleId) === -1) {
    ctx.solved.push(puzzleId);
  }
  ctx.points = Number(ctx.points || 0) + deltaPoints;

  var solveMission =
    (existingRow && existingRow[2]) ||
    mission ||
    'L' + (data.puzzleLevel || 1) + '_PUZZLE_' + puzzleId;
  var unlockedStr = Array.isArray(data.unlockedPuzzles)
    ? uniqueNumbers(data.unlockedPuzzles).join(',')
    : uniqueNumbers(ctx.solved).join(',');
  var solvedStr = uniqueNumbers(ctx.solved).join(',');

  var solveRow = [
    safeCell(tid),
    safeCell(teamName),
    safeCell(solveMission),
    puzzleId,
    wrongAttempts,
    timestamp,
    hintUsed,
    tabSwitches,
    deltaPoints,
    isRepeatSolve ? 'REPEAT_SOLVE' : 'SOLVED',
    ctx.points,
    safeCell(unlockedStr),
    safeCell(solvedStr),
  ];

  if (targetRowIdx <= 0) {
    targetRowIdx = Math.max(2, sheet.getLastRow() + 1);
  }
  writeSingleRow_(sheet, targetRowIdx, solveRow);
  updateTeamContextForRow_(ctx, label, targetRowIdx, solveRow);
  cacheTeamContext_(tid, teamName, ctx, cfg);
  markEventProcessed(data.eventId, cfg);
  return true;
}

function writeSingleRow_(sheet, rowIdx, rowData) {
  if (rowIdx <= 0 || !rowData) return;
  var maxRows = sheet.getMaxRows();
  if (rowIdx > maxRows) {
    sheet.insertRowsAfter(maxRows, rowIdx - maxRows);
  }
  var maxCols = sheet.getMaxColumns();
  if (rowData.length > maxCols) {
    sheet.insertColumnsAfter(maxCols, rowData.length - maxCols);
  }
  sheet.getRange(rowIdx, 1, 1, rowData.length).setValues([rowData]);
}

// ============================================================================
// ADMIN TELEMETRY SNAPSHOT (CACHED & INVALIDATED ON MUTATIONS)
// ============================================================================

function getAdminData_(cfg) {
  var cacheKey = adminSnapshotCacheKey_(cfg);
  var cached = cacheGetJson_(cacheKey);
  if (cached && cached.epoch === cfg.epoch && Array.isArray(cached.logs)) {
    return cached;
  }

  var ss = getSpreadsheet_(cfg);
  ensureSheetsExist(ss, cfg, false);
  var list = [];

  var regSheet = ss.getSheetByName(cfg.sheets.reg);
  var regData =
    regSheet && regSheet.getLastRow() > 1 ? regSheet.getDataRange().getValues() : [];
  for (var i = 1; i < regData.length; i++) {
    var row = regData[i];
    if (!row || (!row[1] && !row[2])) continue;
    var regTs = String(row[0] || '');
    list.push({
      id: 'reg_' + (cellText_(row[1]) || cellText_(row[2]) || i),
      isSummary: true,
      action: 'REGISTRATION',
      registered: true,
      registeredAt: regTs,
      timestamp: regTs,
      lastActive: regTs,
      tid: cellText_(row[1]),
      teamName: cellText_(row[2]),
      mission: cellText_(row[3]),
      language: cellText_(row[4]) || 'PYTHON',
      level: 'REG',
      sheetLevel: cellText_(row[5]) || '1',
      sessionId: cellText_(row[6]),
    });
  }

  cfg.levelTabs.forEach(function (tab) {
    var sheet = ss.getSheetByName(tab.sheetName);
    var rows = sheet && sheet.getLastRow() > 1 ? sheet.getDataRange().getValues() : [];
    for (var j = 1; j < rows.length; j++) {
      var r = rows[j];
      if (!r || (!r[0] && !r[1])) continue;
      var pid = parseInt(r[3] || 0, 10) || 0;
      var ts = String(r[5] || '');
      list.push({
        id: tab.levelKey + '_row_' + (j + 1) + '_' + pid,
        isSummary: true,
        action: 'SUMMARY',
        tid: cellText_(r[0]),
        teamName: cellText_(r[1]),
        mission: cellText_(r[2]),
        level: tab.levelKey,
        puzzleId: pid,
        wrongAttempts: parseInt(r[4] || 0, 10) || 0,
        timestamp: ts,
        lastActive: ts,
        hintUsed: isHintFlag(r[6]),
        tabSwitches: parseInt(r[7] || 0, 10) || 0,
        points: parseFloat(r[8] || 0) || 0,
        status: cellText_(r[9]),
        totalScore: parseFloat(r[10] || 0) || 0,
        unlockedPuzzles: cellText_(r[11]),
        solvedPuzzles: cellText_(r[12]),
      });
    }
  });

  var payload = {
    status: 'success',
    epoch: cfg.epoch,
    logs: list,
  };
  var snapshotTtl = Math.min(
    cfg.cacheTtlSecs,
    Math.max(5, Math.floor(cfg.teamRateWindowSecs / 6))
  );
  cachePutJson_(cacheKey, payload, snapshotTtl);
  return payload;
}
