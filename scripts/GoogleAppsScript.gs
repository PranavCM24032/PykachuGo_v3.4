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
  if (token && token.length >= 32 && token !== getPlayerToken()) {
    return token;
  }
  var playerToken = getPlayerToken();
  if (!playerToken) {
    Logger.log('ADMIN_TOKEN must be configured in Script Properties');
    return '';
  }
  // Dynamic fallback derived from player token without hardcoding secrets
  var rawBytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, playerToken + ':pykachu-admin-salt-2026');
  return rawBytes.map(function(b) { return ('0' + (b & 0xFF).toString(16)).slice(-2); }).join('');
}

function getLoginSessionSecret_() {
  var secret = PropertiesService.getScriptProperties().getProperty('LOGIN_SESSION_SECRET');
  if (secret && secret.length >= 32 && secret !== getPlayerToken()) {
    return secret;
  }
  var token = getPlayerToken();
  if (!token) {
    Logger.log('LOGIN_SESSION_SECRET and PLAYER_TOKEN are both missing');
    return '';
  }
  // Dynamic 64-char fallback derived from player token without hardcoding secrets
  var rawBytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, token + ':pykachu-session-salt-2026');
  return rawBytes.map(function(b) { return ('0' + (b & 0xFF).toString(16)).slice(-2); }).join('');
}

function getSpreadsheet_() {
  var id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  if (id) return SpreadsheetApp.openById(id);
  return SpreadsheetApp.getActiveSpreadsheet();
}

// ── Server-authoritative puzzle catalogue ────────────────────────────────
// data/puzzle.json (the file the client also loads) is the single source of
// truth. Set DATA_BASE_URL in Script Properties to the public site root.

var LOGIN_SESSION_TTL_SECS = 21600;
var LOGIN_RATE_LIMIT = 10;
var START_CODE_RATE_LIMIT = 10;
var AUTH_RATE_WINDOW_SECS = 60;
var ADMIN_AUTH_RATE_LIMIT = 5;

function getDataBaseUrl_() {
  var configured = PropertiesService.getScriptProperties().getProperty('DATA_BASE_URL');
  var base = String(configured || '').trim();
  if (base && base.charAt(base.length - 1) !== '/') base += '/';
  return base;
}

// Fetch one of the public data/*.json files (cached briefly) so the client and
// server always agree on the puzzle graph, answers and team roster.
function readDataJson_(file) {
  var base = getDataBaseUrl_();
  if (!base) {
    Logger.log('DATA_BASE_URL script property is not configured. Cannot fetch ' + file);
    return null;
  }
  var cache = CacheService.getScriptCache();
  var cacheKey = 'datajson:' + file;
  var cached = cache.get(cacheKey);
  if (cached) {
    try { return JSON.parse(cached); } catch (e) { }
  }
  var url = base + 'data/' + file;
  try {
    var res = UrlFetchApp.fetch(url, { muteHttpExceptions: true, followRedirects: true });
    if (res.getResponseCode() !== 200) {
      Logger.log('Could not load ' + url + ' (HTTP ' + res.getResponseCode() + ')');
      return null;
    }
    var text = res.getContentText();
    cache.put(cacheKey, text, 21600); // 6 hours (entire event duration)
    return JSON.parse(text);
  } catch (e) {
    Logger.log('Error fetching ' + url + ': ' + e);
    return null;
  }
}

function getPuzzleCatalogue_() {
  var raw = PropertiesService.getScriptProperties().getProperty('PUZZLE_SECRETS_JSON');
  if (raw) {
    try {
      var parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') return parsed;
    } catch (e) {
      Logger.log('Invalid PUZZLE_SECRETS_JSON: ' + e);
    }
  }
  try {
    var list = readDataJson_('puzzle.json');
    var catalogue = {};
    (Array.isArray(list) ? list : []).forEach(function(p) {
      var id = Number(p && p.id);
      if (!id) return;
      catalogue[id] = {
        level: p.level,
        points: p.points,
        answer: p.answer,
        startCode: p.startCode,
        next: p.nextPuzzleId || [],
        hint: p.hint
      };
    });
    return catalogue;
  } catch (e) {
    Logger.log('Could not build puzzle catalogue from data/puzzle.json: ' + e);
    return {};
  }
}

function normalizeTokenValue(value) {
  return String(value == null ? '' : value).replace(/\s+/g, '').toUpperCase();
}

// Reads a cell as text, removing the leading apostrophe that safeCell() adds
// to formula-like values so identity matching still works after sanitising.
function cellText_(value) {
  var s = String(value == null ? '' : value).trim();
  return s.charAt(0) === "'" ? s.slice(1) : s;
}

function getPuzzleSecret(id) {
  var catalogue = getPuzzleCatalogue_();
  var n = Number(id);
  return catalogue[n] || null;
}

function computeAllowedFromSolved(solved) {
  var catalogue = getPuzzleCatalogue_();
  var allowed = {};
  Object.keys(catalogue).forEach(function(k) {
    if (String(catalogue[k].startCode || '').trim()) allowed[Number(k)] = true;
  });
  (solved || []).forEach(function(s) {
    var sec = catalogue[Number(s)];
    if (!sec) return;
    allowed[Number(s)] = true;
    (sec.next || []).forEach(function(n) { allowed[Number(n)] = true; });
  });
  return Object.keys(allowed).map(Number).sort(function(a, b) { return a - b; });
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
    return { solved: [], points: 0, hintsUsed: [], currentPuzzle: null };
  }
  var cache = CacheService.getScriptCache();
  var cKey = 'ctx_' + String(tid || teamName || '').replace(/[^A-Za-z0-9_]/g, '_');
  var cached = cKey !== 'ctx_' ? cache.get(cKey) : null;
  if (cached) {
    try { return JSON.parse(cached); } catch (e) { }
  }

  var solved = [];
  var points = 0;
  var hintsUsed = [];
  var currentPuzzle = null;
  var latestPuzzleTimestamp = -1;

  ['L1', 'L2', 'L3'].forEach(function(name) {
    var sheet = ss.getSheetByName(name);
    if (!sheet) return;
    var rows = sheet.getDataRange().getValues();
    for (var i = 1; i < rows.length; i++) {
      if (!teamRowMatches(rows[i], 0, 1, tid, teamName)) continue;
      var status = String(rows[i][9] || '');
      var pid = Number(rows[i][3] || 0);

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
    currentPuzzle: currentPuzzle
  };

  if (cKey !== 'ctx_') {
    try { cache.put(cKey, JSON.stringify(result), 180); } catch (e) { }
  }
  return result;
}

function invalidateTeamContext(tid, teamName) {
  try {
    var cKey = 'ctx_' + String(tid || teamName || '').replace(/[^A-Za-z0-9_]/g, '_');
    if (cKey !== 'ctx_') CacheService.getScriptCache().remove(cKey);
  } catch (e) { }
}

function getLoginSession(data) {
  var token = data && data.loginToken;
  if (!token) return null;
  var secret = getLoginSessionSecret_();
  if (!secret) return null;

  // 1. Fast cache check
  try {
    var raw = CacheService.getScriptCache().get('login_v2_' + token);
    if (raw) {
      var cachedSession = JSON.parse(raw);
      if (cachedSession.exp > Date.now()) {
        return { tid: cachedSession.tid || '', teamName: cachedSession.teamName || '' };
      }
      CacheService.getScriptCache().remove('login_v2_' + token);
    }
  } catch (e) { }

  // 2. Cryptographic signature fallback: preserves sessions if cache is evicted.
  try {
    var parts = String(token).split('.');
    if (parts.length === 2) {
      var payloadBytes = Utilities.base64DecodeWebSafe(parts[0]);
      var payload = Utilities.newBlob(payloadBytes).getDataAsString();
      var expectedSig = Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(payload, secret));
      if (parts[1] === expectedSig) {
        var parsedPayload = JSON.parse(payload);
        if (!parsedPayload || typeof parsedPayload.exp !== 'number' || parsedPayload.exp <= Date.now()) {
          return null;
        }
        var session = {
          tid: parsedPayload.tid || '',
          teamName: parsedPayload.teamName || ''
        };
        try {
          CacheService.getScriptCache().put(
            'login_v2_' + token,
            JSON.stringify({ tid: session.tid, teamName: session.teamName, exp: parsedPayload.exp }),
            LOGIN_SESSION_TTL_SECS
          );
        } catch (ce) { }
        return session;
      }
    }
  } catch (e) { }

  return null;
}

function createLoginSession(tid, teamName) {
  var secret = getLoginSessionSecret_();
  if (!secret) return '';
  var expiresAt = Date.now() + LOGIN_SESSION_TTL_SECS * 1000;
  var payload = JSON.stringify({
    tid: tid || '',
    teamName: teamName || '',
    exp: expiresAt
  });
  var sig = Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(payload, secret));
  var signedToken = Utilities.base64EncodeWebSafe(Utilities.newBlob(payload).getBytes()) + '.' + sig;

  try {
    CacheService.getScriptCache().put(
      'login_v2_' + signedToken,
      JSON.stringify({ tid: tid || '', teamName: teamName || '', exp: expiresAt }),
      LOGIN_SESSION_TTL_SECS
    );
  } catch (e) { }

  return signedToken;
}

function getTeamRoster_() {
  try {
    var list = readDataJson_('teams.json');
    return Array.isArray(list) ? list : [];
  } catch (e) {
    Logger.log('Could not load data/teams.json: ' + e);
    return [];
  }
}

function resolveTeamKey_(tid, teamName) {
  var raw = PropertiesService.getScriptProperties().getProperty('TEAM_KEYS_JSON');
  if (raw) {
    try {
      var map = JSON.parse(raw) || {};
      var configuredId = String(tid || '').trim().toUpperCase();
      var configuredName = String(teamName || '').trim().toUpperCase();
      var keys = Object.keys(map);
      for (var i = 0; i < keys.length; i++) {
        var k = String(keys[i]).trim().toUpperCase();
        if ((configuredId && k === configuredId) || (configuredName && k === configuredName)) return String(map[keys[i]] || '');
      }
      return '';
    } catch (e) {
      Logger.log('Invalid TEAM_KEYS_JSON: ' + e);
      return '';
    }
  }

  // Fallback: keys live in data/teams.json, the same roster the client loads.
  var tId = String(tid || '').trim().toUpperCase();
  var tName = String(teamName || '').trim().toUpperCase();
  var roster = getTeamRoster_();
  for (var r = 0; r < roster.length; r++) {
    var row = roster[r] || {};
    var rowTid = String(row.tid || '').trim().toUpperCase();
    var rowName = String(row.team || '').trim().toUpperCase();
    if ((tId && rowTid === tId) || (tName && rowName === tName)) {
      return String(row.securityKey == null ? '' : row.securityKey);
    }
  }
  return '';
}

function getTeamRateIdentity_(tid, teamName) {
  var raw = PropertiesService.getScriptProperties().getProperty('TEAM_KEYS_JSON');
  var tId = String(tid || '').trim().toUpperCase();
  var tName = String(teamName || '').trim().toUpperCase();

  if (raw) {
    try {
      var map = JSON.parse(raw) || {};
      var keys = Object.keys(map);
      // Match the same precedence as LOGIN: a configured name key wins over TID.
      for (var i = 0; i < keys.length; i++) {
        if (tName && String(keys[i]).trim().toUpperCase() === tName) {
          return 'team_' + String(keys[i]).replace(/[^A-Za-z0-9_]/g, '_');
        }
      }
      for (var j = 0; j < keys.length; j++) {
        if (tId && String(keys[j]).trim().toUpperCase() === tId) {
          return 'team_' + String(keys[j]).replace(/[^A-Za-z0-9_]/g, '_');
        }
      }
      // Unknown names share one bucket, so varying arbitrary names cannot reset it.
      return 'unknown';
    } catch (e) {
      Logger.log('Invalid TEAM_KEYS_JSON while rate limiting: ' + e);
      return 'unknown';
    }
  }

  // Fallback: derive a stable bucket from data/teams.json.
  var roster = getTeamRoster_();
  for (var r = 0; r < roster.length; r++) {
    var row = roster[r] || {};
    var rowTid = String(row.tid || '').trim().toUpperCase();
    var rowName = String(row.team || '').trim().toUpperCase();
    if ((tName && rowName === tName) || (tId && rowTid === tId)) {
      return 'team_' + String(rowTid || rowName).replace(/[^A-Za-z0-9_]/g, '_');
    }
  }
  return 'unknown';
}

function checkSlidingWindowRate_(scope, identity, limit) {
  var key = 'authrate_' + String(scope) + '_' + String(identity)
    .replace(/[^A-Za-z0-9_]/g, '_').substring(0, 180);
  var lock = LockService.getScriptLock();
  // Fail closed if concurrent requests prevent an atomic rate-limit update.
  if (!lock.tryLock(1000)) return false;
  try {
    var cache = CacheService.getScriptCache();
    var now = Date.now();
    var cutoff = now - AUTH_RATE_WINDOW_SECS * 1000;
    var attempts = [];
    var raw = cache.get(key);
    if (raw) {
      try {
        attempts = JSON.parse(raw).filter(function(t) {
          return typeof t === 'number' && t > cutoff && t <= now;
        });
      } catch (e) {
        attempts = [];
      }
    }
    if (attempts.length >= limit) {
      cache.put(key, JSON.stringify(attempts), AUTH_RATE_WINDOW_SECS + 1);
      return false;
    }
    attempts.push(now);
    cache.put(key, JSON.stringify(attempts), AUTH_RATE_WINDOW_SECS + 1);
    return true;
  } finally {
    lock.releaseLock();
  }
}

function checkLoginRate(teamIdentity) {
  return checkSlidingWindowRate_('login', teamIdentity, LOGIN_RATE_LIMIT);
}

function jsonResponse_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
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
    if (!data || typeof data !== 'object' || !data.action || !data.token) {
      return ContentService.createTextOutput(JSON.stringify({ status: "error", message: "missing fields" }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    // A client must never be able to claim that the server verified an answer.
    // Only SUBMIT_ANSWER sets this flag, on an event it builds itself.
    delete data._serverVerified;
    if (Array.isArray(data.events)) {
      data.events.forEach(function(ev) {
        if (ev && typeof ev === 'object') delete ev._serverVerified;
      });
    }

    if (data.action === 'ADMIN_AUTH') {
      if (!checkSlidingWindowRate_('admin', 'global', ADMIN_AUTH_RATE_LIMIT)) {
        return jsonResponse_({
          status: 'rate_limited',
          message: 'Too many administrator authentication attempts',
          retryAfterSeconds: AUTH_RATE_WINDOW_SECS
        });
      }
      var adminTokenCheck = getAdminToken();
      if (!adminTokenCheck || data.adminToken !== adminTokenCheck) {
        return jsonResponse_({ status: 'error', message: 'unauthorized' });
      }
      var adminSession = Utilities.getUuid();
      CacheService.getScriptCache().put('admin_sess_' + adminSession, '1', 21600);
      return jsonResponse_({ status: 'success', session: adminSession });
    }

    if (data.action === 'ADMIN_GET_DATA') {
      if (!isAdminSessionValid_(data.session)) {
        return jsonResponse_({ status: 'error', message: 'admin login required' });
      }
      return jsonResponse_(getAdminData_());
    }

    if (data.action === 'RESET_ALL') {
      if (!isAdminSessionValid_(data.session)) {
        return jsonResponse_({ status: 'error', message: 'admin login required' });
      }

      lockAcquired = lock.tryLock(20000);
      if (!lockAcquired) {
        return ContentService.createTextOutput(JSON.stringify({ status: "error", message: "lock unavailable" }))
          .setMimeType(ContentService.MimeType.JSON);
      }

      var resetSpreadsheet = getSpreadsheet_();
      ensureSheetsExist(resetSpreadsheet);
      var sheetsToWipe = ['Registration', 'L1', 'L2', 'L3'];
      sheetsToWipe.forEach(function(name) {
        var sheet = resetSpreadsheet.getSheetByName(name);
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

    if (data.action === 'LOGIN') {
      var loginName = (data.teamName || data.team || '').toString().trim();
      var loginTid = (data.tid || '').toString().trim();
      if (!loginName && !loginTid) {
        return jsonResponse_({ status: 'error', message: 'missing team' });
      }
      // Resolve the name and tid independently so a caller cannot pair their
      // own valid name with someone else's tid to read that team's rows.
      var keyByName = loginName ? resolveTeamKey_('', loginName) : '';
      var keyByTid = loginTid ? resolveTeamKey_(loginTid, '') : '';
      var expectedKey = keyByName || keyByTid;
      var loginRateIdentity = getTeamRateIdentity_(loginTid, loginName);
      if (!checkLoginRate(loginRateIdentity)) {
        return jsonResponse_({ status: 'rate_limited', message: 'Too many login attempts', retryAfterSeconds: AUTH_RATE_WINDOW_SECS });
      }
      if (!expectedKey || String(data.securityKey || '') !== expectedKey) {
        return jsonResponse_({ status: 'error', message: 'invalid credentials' });
      }
      var canonicalTid = (keyByTid && keyByTid === expectedKey) ? loginTid : '';
      var canonicalName = (keyByName && keyByName === expectedKey) ? loginName : '';
      var loginToken = createLoginSession(canonicalTid, canonicalName);
      if (!loginToken) {
        return jsonResponse_({ status: 'error', message: 'login sessions are not configured' });
      }
      return jsonResponse_({
        status: 'success',
        tid: canonicalTid,
        teamName: canonicalName,
        loginToken: loginToken
      });
    }

    var ss = getSpreadsheet_();
    if (data.action === 'GET_TEAM_STATE') {
      var missingSheet = ['Registration', 'L1', 'L2', 'L3'].some(function(name) {
        return !ss.getSheetByName(name);
      });
      if (missingSheet) {
        lockAcquired = lock.tryLock(20000);
        if (!lockAcquired) {
          return ContentService.createTextOutput(JSON.stringify({ status: "error", message: "lock unavailable" }))
            .setMimeType(ContentService.MimeType.JSON);
        }
        ensureSheetsExist(ss);
        lock.releaseLock();
        lockAcquired = false;
      }

      // The team identity comes from the server-issued login session, never
      // from the request body, so a team cannot read another team's state.
      var stateSession = getLoginSession(data);
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

    if (data.action === 'SUBMIT_START_CODE') {
      var startSession = getLoginSession(data);
      if (!startSession) return jsonResponse_({ status: 'error', message: 'login required' });
      var startRateIdentity = getTeamRateIdentity_(startSession.tid, startSession.teamName);
      if (!checkSlidingWindowRate_('startcode', startRateIdentity, START_CODE_RATE_LIMIT)) {
        return jsonResponse_({ status: 'rate_limited', message: 'Too many start-code attempts', retryAfterSeconds: AUTH_RATE_WINDOW_SECS });
      }
      var startCode = normalizeTokenValue(data.startCode || data.code || '');
      var requestedId = Number(data.puzzleId || 0);
      var matchedId = 0;
      if (requestedId > 0) {
        var requestedSecret = getPuzzleSecret(requestedId);
        if (requestedSecret && requestedSecret.startCode &&
            normalizeTokenValue(requestedSecret.startCode) === startCode) {
          matchedId = requestedId;
        }
      } else {
        var startCatalogue = getPuzzleCatalogue_();
        Object.keys(startCatalogue).forEach(function(k) {
          var sec = startCatalogue[k];
          if (!matchedId && sec.startCode &&
              normalizeTokenValue(sec.startCode) === startCode) {
            matchedId = Number(k);
          }
        });
      }
      return jsonResponse_({ status: 'success', correct: matchedId > 0, puzzleId: matchedId });
    }

    if (data.action === 'GET_HINT') {
      var hintSession = getLoginSession(data);
      if (!hintSession) return jsonResponse_({ status: 'error', message: 'login required' });
      var hintPid = Number(data.puzzleId || 0);
      var hintSecret = getPuzzleSecret(hintPid);
      if (!hintSecret || !hintSecret.hint) return jsonResponse_({ status: 'error', message: 'no hint' });
      var hintCtx = getTeamContext(ss, hintSession.tid, hintSession.teamName);
      var hintAllowed = computeAllowedFromSolved(hintCtx.solved);
      if (hintAllowed.indexOf(hintPid) === -1) return jsonResponse_({ status: 'error', message: 'locked' });
      return jsonResponse_({ status: 'success', hint: hintSecret.hint });
    }

    lockAcquired = lock.tryLock(20000);
    if (!lockAcquired) {
      return ContentService.createTextOutput(JSON.stringify({ status: "error", message: "lock unavailable" }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    ensureSheetsExist(ss);

    // Every write must carry the server-issued login session. The session is
    // the only trusted source of team identity; body fields are ignored.
    var writeSession = getLoginSession(data);
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

    if (data.action === 'SUBMIT_ANSWER') {
      var answerPid = Number(data.puzzleId || 0);
      var answerSecret = getPuzzleSecret(answerPid);
      if (!answerSecret) return jsonResponse_({ status: 'error', message: 'unknown puzzle' });

      var answerTid = writeSession.tid || '';
      var answerTeamName = writeSession.teamName || '';
      var answerCtx = getTeamContext(ss, answerTid, answerTeamName);
      var answerAllowed = computeAllowedFromSolved(answerCtx.solved);
      if (answerAllowed.indexOf(answerPid) === -1) {
        return jsonResponse_({ status: 'error', message: 'locked' });
      }

      if (normalizeTokenValue(data.answer) !== normalizeTokenValue(answerSecret.answer)) {
        return jsonResponse_({ status: 'success', correct: false });
      }

      var answerEventId = data.eventId || '';
      if (answerEventId && isDuplicateEvent(answerEventId)) {
        return jsonResponse_({
          status: 'success',
          correct: true,
          repeat: answerCtx.solved.indexOf(answerPid) !== -1,
          points: 0,
          score: answerCtx.points,
          solved: answerCtx.solved,
          unlocked: computeAllowedFromSolved(answerCtx.solved)
        });
      }

      var answerSheet = ss.getSheetByName('L' + answerSecret.level);
      if (!answerSheet) return jsonResponse_({ status: 'error', message: 'missing level sheet' });
      var answerRows = answerSheet.getDataRange().getValues();
      var answerEvent = {
        action: 'SOLVED',
        teamName: answerTeamName,
        tid: answerTid,
        mission: data.mission || '',
        puzzleId: answerPid,
        puzzleLevel: answerSecret.level,
        wrongAttempts: data.wrongAttempts,
        tabSwitches: data.tabSwitches,
        hintUsed: data.hintUsed,
        hintsUsed: data.hintsUsed,
        scanCount: data.scanCount,
        timestamp: new Date().toISOString(),
        eventId: answerEventId,
        _serverVerified: true
      };

      var answerRowIdx = applyEvent(answerRows, answerEvent, answerCtx);
      if (answerRowIdx > 0) {
        writeRow(answerSheet, answerRows, answerRowIdx);
        if (answerEventId) markEventProcessed(answerEventId);
        invalidateTeamContext(answerTid, answerTeamName);
      }
      SpreadsheetApp.flush();

      return jsonResponse_({
        status: 'success',
        correct: true,
        repeat: !!answerCtx.lastRepeat,
        points: Number(answerCtx.lastDelta || 0),
        score: answerCtx.points,
        solved: answerCtx.solved,
        unlocked: computeAllowedFromSolved(answerCtx.solved)
      });
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
          }
        });

        Object.keys(touched).forEach(function(idx) {
          writeRow(sheet, rows, Number(idx));
        });
        applied.forEach(markEventProcessed);
        invalidateTeamContext(writeSession.tid, writeSession.teamName);
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
    if (rowIdx <= 0) return -1;
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

  // Only a SOLVED event the server itself verified (SUBMIT_ANSWER) is trusted.
  if (action === 'SOLVED' && !data._serverVerified) return -1;

  var secret = getPuzzleSecret(puzzleId);
  if (action === 'SOLVED' && !secret) return -1;

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
    record.mission = record.mission || ('L' + secret.level + '_PUZZLE_' + puzzleId);

    // Points are computed server-side from the secret catalogue. A repeat
    // solve is always a deduction, never a client-supplied value.
    var deltaPoints = isRepeatSolve ? -Number(secret.points || 0) : Number(secret.points || 0);
    record.points = (String(record.points).trim() === '') ? 0 : Number(record.points);
    record.points += deltaPoints;

    if (ctx) {
      if (!isRepeatSolve && ctx.solved.indexOf(puzzleId) === -1) ctx.solved.push(puzzleId);
      ctx.points = Number(ctx.points || 0) + deltaPoints;
      ctx.lastDelta = deltaPoints;
      ctx.lastRepeat = isRepeatSolve;
      record.totalScore = ctx.points;
      record.unlockedPuzzles = computeAllowedFromSolved(ctx.solved).join(',');
      record.solvedPuzzles = uniqueNumbers(ctx.solved).join(',');
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

function isAdminSessionValid_(session) {
  if (!session) return false;
  return Boolean(CacheService.getScriptCache().get('admin_sess_' + session));
}

function getAdminData_() {
  var ss = getSpreadsheet_();
  ensureSheetsExist(ss);
  var list = [];

  var regSheet = ss.getSheetByName('Registration');
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
      level: regData[i][5],
      sessionId: regData[i][6]
    });
  }

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
        timestamp: rows[j][5],
        hintUsed: isHintFlag(rows[j][6]),
        tabSwitches: parseInt(rows[j][7] || 0, 10),
        points: parseFloat(rows[j][8] || 0),
        status: rows[j][9],
        totalScore: parseFloat(rows[j][10] || 0),
        unlockedPuzzles: rows[j][11],
        solvedPuzzles: rows[j][12]
      });
    }
  });
  return list;
}

function doGet(e) {
  try {
    var params = (e && e.parameter) || {};
    var playerToken = getPlayerToken();
    if (!playerToken || !params.token || params.token !== playerToken) {
      return jsonResponse_({ error: true, message: 'unauthorized' });
    }

    if (params.action === 'GET_EPOCH') {
      var props = PropertiesService.getScriptProperties();
      var epoch = parseInt(props.getProperty('gameEpoch') || '0', 10);
      return jsonResponse_({ epoch: epoch });
    }

    return jsonResponse_({ error: true, message: 'use POST for administrator data' });
  } catch (err) {
    return jsonResponse_({ error: true, message: err.toString() });
  }
}
