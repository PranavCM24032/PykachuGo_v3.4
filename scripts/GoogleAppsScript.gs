// Pykachu v3 Google Apps Script backend.
// Required Script Properties: PLAYER_TOKEN and ADMIN_TOKEN.

var REG_HEADERS = ['Registration Time', 'TID', 'Team Name', 'Mission', 'Language', 'Level', 'Session ID'];
var LEVEL_HEADERS = ['TID', 'Team Name', 'Mission', 'Puzzle ID', 'Wrong Attempts', 'Solve Time', 'Hint Used', 'Tab Switches', 'Points', 'Status', 'Total Score', 'Unlocked Puzzle IDs', 'Solved Puzzle IDs'];
var LEVEL_SHEET_NAMES = ['L1', 'L2', 'L3'];

function doGet(e) {
  var params = (e && e.parameter) || {};
  if (!isPlayerToken_(params.token) && !isAdminToken_(params.token)) return json_({ status: 'error', message: 'unauthorized' });
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  ensureSheets_(ss);
  if (String(params.action || '').toUpperCase() === 'GET_EPOCH') return json_({ status: 'success', epoch: getEpoch_() });
  return json_(adminRows_(ss));
}

function doPost(e) {
  var body = parseJson_(e && e.postData && e.postData.contents);
  if (!body) return json_({ status: 'error', message: 'bad json' });
  var action = String(body.action || '').toUpperCase();
  if (action === 'RESET_ALL') {
    if (!isAdminToken_(body.adminToken || body.token)) return json_({ status: 'error', message: 'unauthorized' });
    return withLock_(resetAll_);
  }
  if (!isPlayerToken_(body.token)) return json_({ status: 'error', message: 'unauthorized' });
  return withLock_(function() {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    ensureSheets_(ss);
    if (action === 'SESSION_BATCH') {
      var events = Array.isArray(body.events) ? body.events : [];
      var changed = 0;
      events.forEach(function(event) { if (isData_(event) && processEvent_(ss, event)) changed++; });
      SpreadsheetApp.flush();
      return json_({ status: 'success', rowsChanged: changed });
    }
    if (action === 'GET_TEAM_STATE') return json_(teamState_(ss, body.tid));
    processEvent_(ss, body);
    SpreadsheetApp.flush();
    return json_({ status: 'success', message: 'written' });
  });
}

function processEvent_(ss, data) {
  var action = normalizeAction_(data.action);
  var teamName = clean_(data.teamName);
  if (!teamName || ['UNKNOWN', 'NO TEAM'].indexOf(teamName.toUpperCase()) >= 0) return false;
  if (action === 'MEME' || action === 'SESSION_START' || action === 'CONNECTION_TEST') return false;
  if (action === 'REGISTRATION') { writeRegistration_(ss, data); return true; }
  var level = levelNumber_(data.puzzleLevel || data.level, data.mission);
  if (!level) return false;
  var sheet = ss.getSheetByName('L' + level);
  var rows = sheet.getDataRange().getValues();
  var puzzleId = int_(data.puzzleId, 0);
  var rowIndex = findLevelRow_(rows, teamName, puzzleId);
  var record = rowIndex < 0 ? newRecord_(data, teamName, puzzleId) : readRecord_(rows[rowIndex]);
  applyEvent_(record, action, data, puzzleId);
  var row = recordRow_(record);
  if (rowIndex < 0) sheet.appendRow(row);
  else sheet.getRange(rowIndex + 1, 1, 1, row.length).setValues([row]);
  return true;
}

function normalizeAction_(action) {
  var value = String(action || '').toUpperCase();
  if (value === 'REGISTER') return 'REGISTRATION';
  if (value === 'PUZZLE_ABANDONED') return 'ABANDONED';
  if (value === 'PENALTY_TRIGGERED' || value === 'MALPRACTICE_DETECTED') return 'PENALTY';
  return value;
}

function applyEvent_(record, action, data, puzzleId) {
  record.tabSwitches = Math.max(record.tabSwitches, int_(data.tabSwitches, 0));
  if (action === 'SOLVED') {
    record.status = record.tabSwitches > 0 ? 'MALPRACTICE' : 'SOLVED';
    record.points = number_(data.points !== undefined ? data.points : data.pointsEarned, record.points);
    record.solveTime = data.solveTime || epoch_();
    record.wrongAttempts = Math.max(record.wrongAttempts, int_(data.wrongAttempts, 0));
    if (data.hintUsed !== undefined) record.hintUsed = flag_(data.hintUsed) ? '1' : '0';
    record.totalScore = number_(data.totalScore, record.totalScore + record.points);
    record.solvedPuzzles = mergeIds_(record.solvedPuzzles, data.solvedPuzzles || data.solvedIds, puzzleId);
    record.unlockedPuzzles = mergeIds_(record.unlockedPuzzles, data.unlockedPuzzles || data.queueIds);
  } else if (action === 'ABANDONED') {
    if (!isFinal_(record.status)) record.status = 'ABANDONED';
    record.wrongAttempts = Math.max(record.wrongAttempts, int_(data.wrongAttempts, 0));
  } else if (action === 'WRONG_ATTEMPT') {
    if (!isFinal_(record.status)) record.wrongAttempts = Math.max(record.wrongAttempts, int_(data.attemptCount, record.wrongAttempts + 1));
  } else if (action === 'HINT_USED' || action === 'HINT_REQUESTED') {
    if (!isFinal_(record.status)) record.hintUsed = '1';
  } else if (action === 'PENALTY' || action === 'TAB_SWITCH') {
    record.tabSwitches = Math.max(record.tabSwitches, int_(data.tabSwitches, record.tabSwitches + 1));
    if (record.status !== 'SOLVED') record.status = 'MALPRACTICE';
  } else if (action === 'PUZZLE_UNLOCKED') {
    if (!isFinal_(record.status)) record.status = 'UNLOCKED';
  } else if (action === 'UNLOCK_FAILED') {
    if (!isFinal_(record.status)) record.status = 'LOCKED';
  } else if (action === 'QR_BLOCKED') {
    if (!isFinal_(record.status)) record.status = 'BLOCKED';
  }
}

function writeRegistration_(ss, data) {
  var sheet = ss.getSheetByName('Registration');
  var rows = sheet.getDataRange().getValues();
  var team = clean_(data.teamName);
  var row = [epoch_(), data.tid || '', team, data.mission || '', data.language || '', data.level || levelNumber_(data.puzzleLevel, data.mission) || '', data.sessionId || ''];
  var index = -1;
  for (var i = 1; i < rows.length; i++) if (teamKey_(rows[i][2]) === teamKey_(team)) { index = i; break; }
  if (index < 0) sheet.appendRow(row);
  else sheet.getRange(index + 1, 1, 1, row.length).setValues([row]);
}

function teamState_(ss, tid) {
  var solved = [], unlocked = [], score = 0, latest = null;
  LEVEL_SHEET_NAMES.forEach(function(name) {
    var rows = ss.getSheetByName(name).getDataRange().getValues();
    for (var i = 1; i < rows.length; i++) if (String(rows[i][0]) === String(tid || '')) {
      addIds_(solved, rows[i][12]); addIds_(unlocked, rows[i][11]); score = number_(rows[i][10], score); latest = rows[i];
    }
  });
  return { status: 'success', solved: solved, unlocked: unlocked, score: score, currentPuzzle: latest ? int_(latest[3], 0) : 0 };
}

function adminRows_(ss) {
  var out = [], registrations = ss.getSheetByName('Registration').getDataRange().getValues();
  for (var i = 1; i < registrations.length; i++) { var r = registrations[i]; if (r[2]) out.push({ action: 'REGISTRATION', lastActive: r[0], timestamp: r[0], tid: r[1], teamName: r[2], mission: r[3], language: r[4], level: 'L' + r[5], sessionId: r[6] }); }
  LEVEL_SHEET_NAMES.forEach(function(name) {
    var rows = ss.getSheetByName(name).getDataRange().getValues();
    for (var j = 1; j < rows.length; j++) { var r = rows[j]; if (!r[1] || !int_(r[3], 0)) continue; out.push({ action: 'SUMMARY', lastActive: r[5] || '', level: name, tid: r[0], teamName: r[1], mission: r[2], puzzleId: int_(r[3], 0), wrongAttempts: int_(r[4], 0), solveTime: r[5], hintUsed: r[6], tabSwitches: int_(r[7], 0), pointsEarned: Math.max(number_(r[8], 0), 0), pointsLost: Math.abs(Math.min(number_(r[8], 0), 0)), points: number_(r[8], 0), status: r[9] || '', totalScore: number_(r[10], 0), unlockedPuzzles: r[11] || '', solvedPuzzles: r[12] || '' }); }
  });
  return out;
}

function resetAll_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet(); ensureSheets_(ss);
  ['Registration', 'L1', 'L2', 'L3'].forEach(function(name) { var sheet = ss.getSheetByName(name), last = sheet.getLastRow(); if (last > 1) sheet.deleteRows(2, last - 1); });
  var props = PropertiesService.getScriptProperties(), epoch = int_(props.getProperty('GAME_EPOCH'), 0) + 1; props.setProperty('GAME_EPOCH', String(epoch));
  return json_({ status: 'success', epoch: epoch });
}

function ensureSheets_(ss) { ensureSheet_(ss, 'Registration', REG_HEADERS); LEVEL_SHEET_NAMES.forEach(function(name) { ensureSheet_(ss, name, LEVEL_HEADERS); }); }
function ensureSheet_(ss, name, headers) { var sheet = ss.getSheetByName(name) || ss.insertSheet(name); if (sheet.getLastRow() === 0) sheet.appendRow(headers); }
function withLock_(fn) { var lock = LockService.getScriptLock(); if (!lock.tryLock(20000)) return json_({ status: 'error', message: 'lock unavailable' }); try { return fn(); } catch (error) { return json_({ status: 'error', message: String(error.message || error) }); } finally { lock.releaseLock(); } }
function newRecord_(data, teamName, puzzleId) { return { tid: data.tid || '', teamName: teamName, mission: data.mission || '', puzzleId: puzzleId, wrongAttempts: 0, solveTime: '', hintUsed: '0', tabSwitches: 0, points: 0, status: '', totalScore: 0, unlockedPuzzles: '', solvedPuzzles: '' }; }
function readRecord_(row) { return { tid: row[0] || '', teamName: row[1] || '', mission: row[2] || '', puzzleId: int_(row[3], 0), wrongAttempts: int_(row[4], 0), solveTime: row[5] || '', hintUsed: flag_(row[6]) ? '1' : '0', tabSwitches: int_(row[7], 0), points: number_(row[8], 0), status: String(row[9] || ''), totalScore: number_(row[10], 0), unlockedPuzzles: row[11] || '', solvedPuzzles: row[12] || '' }; }
function recordRow_(r) { return [r.tid, r.teamName, r.mission, r.puzzleId, r.wrongAttempts, r.solveTime, r.hintUsed, r.tabSwitches, sign_(r.points), r.status, r.totalScore, r.unlockedPuzzles, r.solvedPuzzles]; }
function findLevelRow_(rows, team, puzzleId) { for (var i = 1; i < rows.length; i++) if (teamKey_(rows[i][1]) === teamKey_(team) && int_(rows[i][3], 0) === puzzleId) return i; return -1; }
function levelNumber_(value, mission) { var n = int_(value, 0); if (n >= 1 && n <= 3) return n; var m = String(mission || '').match(/L([123])/i); return m ? int_(m[1], 0) : 0; }
function mergeIds_(existing, incoming, forced) { var ids = []; addIds_(ids, existing); addIds_(ids, incoming); if (forced) addIds_(ids, forced); return ids.join(','); }
function addIds_(out, value) { String(value || '').split(/[,;]/).forEach(function(v) { var n = int_(v.trim(), 0); if (n > 0 && out.indexOf(n) < 0) out.push(n); }); }
function isFinal_(status) { return status === 'SOLVED' || status === 'MALPRACTICE'; }
function flag_(value) { return value === true || value === 1 || ['1', 'TRUE', 'YES', 'Y'].indexOf(String(value).toUpperCase()) >= 0; }
function clean_(value) { return String(value == null ? '' : value).trim(); }
function teamKey_(value) { return clean_(value).toUpperCase(); }
function int_(value, fallback) { var n = parseInt(value, 10); return isNaN(n) ? fallback : n; }
function number_(value, fallback) { var n = Number(value); return isNaN(n) ? fallback : n; }
function sign_(value) { var n = number_(value, 0); return n > 0 ? '+' + n : String(n); }
function epoch_() { return Math.floor(Date.now() / 1000); }
function getEpoch_() { return int_(PropertiesService.getScriptProperties().getProperty('GAME_EPOCH'), 0); }
function parseJson_(value) { try { return value ? JSON.parse(value) : null; } catch (error) { return null; } }
function isData_(value) { return value && typeof value === 'object' && !Array.isArray(value); }
function json_(value) { return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON); }
function isPlayerToken_(token) { var expected = PropertiesService.getScriptProperties().getProperty('PLAYER_TOKEN'); return !!expected && String(token) === String(expected); }
function isAdminToken_(token) { var expected = PropertiesService.getScriptProperties().getProperty('ADMIN_TOKEN'); return !!expected && String(token) === String(expected); }
