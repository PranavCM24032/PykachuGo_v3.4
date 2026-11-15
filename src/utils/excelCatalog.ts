import * as XLSX from 'xlsx';
import type { MemeEntry, Puzzle, TeamEntry } from '../types/game';

export interface ParsedSpreadsheetResult<T> {
  valid: T[];
  errors: { row: number; reason: string }[];
  rawCount: number;
}

function normalizeHeader(key: string): string {
  return String(key || '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function normalizeRow(raw: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  Object.entries(raw).forEach(([k, v]) => {
    const nk = normalizeHeader(k);
    if (nk) out[nk] = v;
  });
  return out;
}

function pickStr(row: Record<string, unknown>, keys: string[]): string {
  for (const k of keys) {
    const val = row[k];
    if (val !== undefined && val !== null && String(val).trim() !== '') {
      return String(val).trim();
    }
  }
  return '';
}

function pickNum(row: Record<string, unknown>, keys: string[], fallback = 0): number {
  for (const k of keys) {
    const val = row[k];
    if (val !== undefined && val !== null && String(val).trim() !== '') {
      const n = Number(val);
      if (!Number.isNaN(n)) return n;
    }
  }
  return fallback;
}

function sanitizeId(raw: string, maxLen: number): string {
  return raw
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, maxLen);
}

async function readFirstSheetRows(file: File): Promise<Record<string, unknown>[]> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array' });
  const firstSheet = wb.SheetNames[0];
  if (!firstSheet) return [];
  const sheet = wb.Sheets[firstSheet];
  return XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' });
}

// ==========================================
// TEAMS EXCEL PARSER & TEMPLATE
// ==========================================
export async function parseTeamsSpreadsheet(
  file: File
): Promise<ParsedSpreadsheetResult<TeamEntry>> {
  const rawRows = await readFirstSheetRows(file);
  const valid: TeamEntry[] = [];
  const errors: { row: number; reason: string }[] = [];

  rawRows.forEach((raw, idx) => {
    const rowNum = idx + 2;
    const r = normalizeRow(raw);

    const team = pickStr(r, ['team', 'teamname', 'name']);
    const rawTid = pickStr(r, ['tid', 'teamid', 'id']);
    const securityKey = pickStr(r, ['securitykey', 'key', 'password', 'pin', 'code']) || '123';

    if (!team) {
      errors.push({ row: rowNum, reason: 'Missing team name (column: team / teamName)' });
      return;
    }
    const tid = sanitizeId((rawTid || `T${String(idx + 1).padStart(3, '0')}`).toUpperCase(), 32);
    if (!tid) {
      errors.push({ row: rowNum, reason: 'Invalid TID characters' });
      return;
    }

    const combinedMembers = pickStr(r, ['teammembers', 'members']);
    let members: string[] = [];
    if (combinedMembers) {
      members = combinedMembers
        .split(/[,|;\n]+/)
        .map((m) => m.trim())
        .filter(Boolean);
    } else {
      for (let mIdx = 1; mIdx <= 12; mIdx++) {
        const val = pickStr(r, [`member${mIdx}`, `player${mIdx}`, `m${mIdx}`]);
        if (val) members.push(val);
      }
    }

    valid.push({
      tid,
      team: team.slice(0, 60),
      securityKey: securityKey.slice(0, 64),
      team_members: members.slice(0, 12),
    });
  });

  return { valid, errors, rawCount: rawRows.length };
}

export function downloadTeamsTemplateXlsx(): void {
  const rows = [
    {
      tid: 'T051',
      team: 'PIKA SQUAD',
      securityKey: 'PIKA123',
      member1: 'Ash Ketchum',
      member2: 'Misty Waterflower',
      member3: 'Brock Harrison',
      member4: 'Pikachu',
    },
    {
      tid: 'T052',
      team: 'CODE CHARIZARD',
      securityKey: 'FIRE999',
      member1: 'Red',
      member2: 'Blue',
      member3: 'Green',
      member4: '',
    },
  ];
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Teams');
  XLSX.writeFile(wb, 'pykachu_teams_template.xlsx');
}

export function exportTeamsToXlsx(teams: TeamEntry[]): void {
  const rows = teams.map((t) => ({
    tid: t.tid,
    team: t.team,
    securityKey: t.securityKey,
    team_members: (t.team_members || []).join(', '),
    member1: t.team_members?.[0] || '',
    member2: t.team_members?.[1] || '',
    member3: t.team_members?.[2] || '',
    member4: t.team_members?.[3] || '',
    source: 'GOOGLE_SHEET',
  }));
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Teams');
  XLSX.writeFile(wb, `pykachu_teams_${new Date().toISOString().slice(0, 10)}.xlsx`);
}

// ==========================================
// MEMES EXCEL PARSER & TEMPLATE
// ==========================================
export async function parseMemesSpreadsheet(
  file: File
): Promise<ParsedSpreadsheetResult<MemeEntry>> {
  const rawRows = await readFirstSheetRows(file);
  const valid: MemeEntry[] = [];
  const errors: { row: number; reason: string }[] = [];

  rawRows.forEach((raw, idx) => {
    const rowNum = idx + 2;
    const r = normalizeRow(raw);

    const rawId = pickStr(r, ['memeid', 'id', 'code']);
    const ytlink = pickStr(r, ['ytlink', 'youtubelink', 'youtube', 'url', 'link']);
    const starttime = Math.max(0, pickNum(r, ['starttime', 'start', 'startsec'], 0));
    const endtime = Math.max(0, pickNum(r, ['endtime', 'end', 'endsec'], 0));

    if (!rawId) {
      errors.push({ row: rowNum, reason: 'Missing memeid (e.g. M03)' });
      return;
    }
    if (!ytlink || ytlink.length < 5) {
      errors.push({ row: rowNum, reason: 'Missing or invalid ytlink' });
      return;
    }

    const memeid = sanitizeId(rawId.toUpperCase(), 32);
    if (!memeid) {
      errors.push({ row: rowNum, reason: 'Invalid memeid format' });
      return;
    }

    valid.push({
      memeid,
      ytlink: ytlink.slice(0, 512),
      starttime,
      endtime: endtime > 0 && endtime < starttime ? starttime : endtime,
    });
  });

  return { valid, errors, rawCount: rawRows.length };
}

export function downloadMemesTemplateXlsx(): void {
  const rows = [
    {
      memeid: 'M03',
      ytlink: 'https://youtube.com/shorts/dQw4w9WgXcQ',
      starttime: 0,
      endtime: 15,
    },
    {
      memeid: 'M04',
      ytlink: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      starttime: 10,
      endtime: 25,
    },
  ];
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Memes');
  XLSX.writeFile(wb, 'pykachu_memes_template.xlsx');
}

export function exportMemesToXlsx(memes: MemeEntry[]): void {
  const rows = memes.map((m) => ({
    memeid: m.memeid,
    ytlink: m.ytlink,
    starttime: m.starttime,
    endtime: m.endtime,
    qrUrl: `${window.location.origin}/?memid=${encodeURIComponent(m.memeid)}`,
    source: 'GOOGLE_SHEET',
  }));
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Memes');
  XLSX.writeFile(wb, `pykachu_memes_${new Date().toISOString().slice(0, 10)}.xlsx`);
}

// ==========================================
// PUZZLES EXCEL PARSER & TEMPLATE
// ==========================================
export async function parsePuzzlesSpreadsheet(
  file: File
): Promise<ParsedSpreadsheetResult<Puzzle>> {
  const rawRows = await readFirstSheetRows(file);
  const valid: Puzzle[] = [];
  const errors: { row: number; reason: string }[] = [];

  rawRows.forEach((raw, idx) => {
    const rowNum = idx + 2;
    const r = normalizeRow(raw);

    const id = Math.floor(pickNum(r, ['id', 'puzzleid'], 0));
    const linkid = pickStr(r, ['linkid', 'qr', 'qrcode', 'slug']).toUpperCase();
    const answer = pickStr(r, ['answer', 'ans', 'solution', 'output']);
    const questionPython = pickStr(r, ['questionpython', 'python', 'pycode', 'pythoncode']);
    const questionCpp = pickStr(r, ['questioncpp', 'cpp', 'cppcode', 'c']);
    const locationClue = pickStr(r, ['locationclue', 'location', 'clue']) || 'Campus Signal Node';
    const level = Math.max(1, Math.min(10, Math.floor(pickNum(r, ['level', 'lvl'], 1))));
    const points = Math.max(0, pickNum(r, ['points', 'pts', 'score'], 10));
    const startCode = pickStr(r, ['startcode', 'unlockcode']).toUpperCase();
    const badgeId = Math.max(0, Math.floor(pickNum(r, ['badgeid', 'badge'], 0)));
    const hint = pickStr(r, ['hint', 'tip']);
    const hintPenalty = Math.max(0, Math.floor(pickNum(r, ['hintpenalty', 'penalty'], 60)));
    const pokemonId = Math.max(0, Math.floor(pickNum(r, ['pokemonid', 'pokeid'], 25)));
    const pokemonName = pickStr(r, ['pokemonname', 'pokemon']) || 'Pikachu';

    const nextRaw = pickStr(r, ['nextpuzzleid', 'next', 'nextids', 'nextpuzzles']);
    const nextPuzzleId = nextRaw
      ? nextRaw
          .split(/[,|;\s]+/)
          .map((n) => Math.floor(Number(n)))
          .filter((n) => !Number.isNaN(n) && n > 0)
      : [];

    if (!id || id < 1 || id > 10000) {
      errors.push({ row: rowNum, reason: 'Invalid numeric id (must be 1..10000)' });
      return;
    }
    if (!linkid) {
      errors.push({ row: rowNum, reason: 'Missing linkid (e.g. XG21)' });
      return;
    }
    if (!answer) {
      errors.push({ row: rowNum, reason: 'Missing answer' });
      return;
    }
    if (!questionPython && !questionCpp) {
      errors.push({
        row: rowNum,
        reason: 'Provide at least questionPython or questionCpp',
      });
      return;
    }

    const hasValidHint =
      Boolean(hint) &&
      !['none', 'false', 'null'].includes(hint.trim().toLowerCase());

    valid.push({
      id,
      linkid: linkid.slice(0, 32),
      badgeId: badgeId > 0 ? badgeId : undefined,
      questionPython: questionPython.slice(0, 8000),
      questionCpp: questionCpp.slice(0, 8000),
      answer: answer.slice(0, 256),
      nextPuzzleId: nextPuzzleId.slice(0, 50),
      startCode: startCode ? startCode.slice(0, 64) : undefined,
      locationClue: locationClue.slice(0, 500),
      level,
      points,
      hint: hasValidHint ? hint.slice(0, 1000) : undefined,
      hasHint: hasValidHint,
      hintPenalty,
      pokemonId,
      pokemonName: pokemonName.slice(0, 80),
    });
  });

  return { valid, errors, rawCount: rawRows.length };
}

export function downloadPuzzlesTemplateXlsx(): void {
  const rows = [
    {
      id: 21,
      linkid: 'XG21',
      level: 1,
      points: 10,
      startCode: '',
      badgeId: 0,
      locationClue: 'Library Entrance Gate',
      pokemonId: 25,
      pokemonName: 'Pikachu',
      answer: '14',
      hint: 'Check loop range carefully',
      hintPenalty: 60,
      nextPuzzleId: '22, 23',
      questionPython: 'total = 0\nfor i in range(2, 6):\n    total += i\nprint(total)',
      questionCpp:
        '#include <iostream>\nusing namespace std;\nint main() {\n    int total = 0;\n    for(int i = 2; i < 6; i++) total += i;\n    cout << total << endl;\n    return 0;\n}',
    },
  ];
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Puzzles');
  XLSX.writeFile(wb, 'pykachu_puzzles_template.xlsx');
}

export function exportPuzzlesToXlsx(puzzles: Puzzle[]): void {
  const rows = puzzles.map((p) => ({
    id: p.id,
    linkid: p.linkid,
    level: p.level,
    points: p.points,
    startCode: p.startCode || '',
    badgeId: p.badgeId || 0,
    locationClue: p.locationClue,
    pokemonId: p.pokemonId,
    pokemonName: p.pokemonName,
    answer: p.answer,
    hint: typeof p.hint === 'string' ? p.hint : '',
    hintPenalty: p.hintPenalty ?? 60,
    nextPuzzleId: (p.nextPuzzleId || []).join(', '),
    questionPython: p.questionPython,
    questionCpp: p.questionCpp,
    qrUrl: `${window.location.origin}/?linkid=${encodeURIComponent(p.linkid)}`,
    source: 'GOOGLE_SHEET',
  }));
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Puzzles');
  XLSX.writeFile(wb, `pykachu_puzzles_${new Date().toISOString().slice(0, 10)}.xlsx`);
}
