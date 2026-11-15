import {
  STORAGE_KEYS,
  type AdminCredential,
  type FirestoreLanguage,
  type GameConfig,
  type LanguageCode,
  type MemeEntry,
  type Puzzle,
  type PuzzleEventAction,
  type PuzzleEventStatus,
  type PuzzleNotebookEntry,
  type StepId,
  type TeamEntry,
  type TeamProgressDoc,
} from '../types/game';

// ==========================================
// GOOGLE APPS SCRIPT OPTIONAL REMOTE SYNC
// (Falls back cleanly to fast local JSON)
// ==========================================
export function hasAppsScriptBackend(): boolean {
  return String(import.meta.env.VITE_APPS_SCRIPT_URL || '').trim().length > 0;
}

function getAppsScriptUrl(): string {
  const url = String(import.meta.env.VITE_APPS_SCRIPT_URL || '').trim();
  if (!url) {
    throw new Error(
      'Apps Script URL not configured (operating in fast local JSON mode).'
    );
  }
  return url;
}

function unwrapAppsScriptPayload(raw: unknown, label: string): Record<string, unknown> | unknown[] {
  if (Array.isArray(raw)) {
    return raw;
  }
  if (!raw || typeof raw !== 'object') {
    throw new Error(`Apps Script ${label} returned empty response.`);
  }
  const obj = raw as Record<string, unknown>;
  if (
    obj.status === 'error' ||
    obj.status === 'rate_limited' ||
    obj.error === true ||
    obj.ok === false
  ) {
    const msg =
      typeof obj.message === 'string'
        ? obj.message
        : typeof obj.error === 'string'
          ? obj.error
          : `Apps Script ${label} failed.`;
    throw new Error(msg);
  }
  if (obj.ok === true && obj.data && typeof obj.data === 'object') {
    return obj.data as Record<string, unknown>;
  }
  return obj;
}

async function callAppsScriptGet(
  action: string,
  params: Record<string, string | number | boolean | undefined> = {},
  timeoutMs = 8000
): Promise<Record<string, unknown> | unknown[]> {
  const baseUrl = getAppsScriptUrl();
  const url = new URL(baseUrl);
  url.searchParams.set('action', action);
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && String(v) !== '') {
      url.searchParams.set(k, String(v));
    }
  });

  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url.toString(), {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`Apps Script HTTP ${response.status}: ${response.statusText}`);
    }

    const parsed: unknown = await response.json();
    return unwrapAppsScriptPayload(parsed, `GET ${action}`);
  } finally {
    window.clearTimeout(timer);
  }
}

async function callAppsScriptPost(
  body: Record<string, unknown>,
  timeoutMs = 8000
): Promise<Record<string, unknown>> {
  const baseUrl = getAppsScriptUrl();
  const action = String(body.action || 'UNKNOWN');
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(baseUrl, {
      method: 'POST',
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'Content-Type': 'text/plain;charset=utf-8',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new Error(`Apps Script HTTP ${response.status}: ${response.statusText}`);
    }

    const parsed: unknown = await response.json();
    const unwrapped = unwrapAppsScriptPayload(parsed, `POST ${action}`);
    return Array.isArray(unwrapped) ? { logs: unwrapped } : unwrapped;
  } finally {
    window.clearTimeout(timer);
  }
}

// ==========================================
// DURABLE TELEMETRY OUTBOX (100+ TEAM SCALE)
// ==========================================
interface PendingSyncItem {
  eventId: string;
  tid: string;
  teamName: string;
  sessionId: string;
  action: string;
  payload: Record<string, unknown>;
  createdAt: number;
}

const MAX_OUTBOX_ITEMS = 500;
let flushInFlight = false;

function readPendingSyncQueue(): PendingSyncItem[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.pendingSyncQueue);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as PendingSyncItem[]) : [];
  } catch {
    return [];
  }
}

function writePendingSyncQueue(items: PendingSyncItem[]): void {
  try {
    if (items.length === 0) {
      localStorage.removeItem(STORAGE_KEYS.pendingSyncQueue);
      return;
    }
    let next = items;
    if (next.length > MAX_OUTBOX_ITEMS) {
      // Preserve REGISTRATION and SOLVED events first when shedding oldest excess telemetry
      const critical = next.filter(
        (i) => i.action === 'REGISTRATION' || i.action === 'SOLVED'
      );
      const nonCritical = next.filter(
        (i) => i.action !== 'REGISTRATION' && i.action !== 'SOLVED'
      );
      const keepNonCrit = Math.max(0, MAX_OUTBOX_ITEMS - critical.length);
      next = [...critical, ...nonCritical.slice(Math.max(0, nonCritical.length - keepNonCrit))]
        .sort((a, b) => a.createdAt - b.createdAt);
    }
    localStorage.setItem(STORAGE_KEYS.pendingSyncQueue, JSON.stringify(next));
  } catch {
    // ignore storage quota errors
  }
}

function enqueueSyncEvent(payload: Record<string, unknown>): void {
  const eventId = String(payload.eventId || '').trim();
  const tid = String(payload.tid || '').trim().toUpperCase();
  const teamName = String(payload.teamName || '').trim();
  const sessionId = String(payload.sessionId || '').trim();
  const action = String(payload.action || '').trim().toUpperCase();
  if (!eventId || (!tid && !teamName)) return;

  const queue = readPendingSyncQueue();
  if (queue.some((item) => item.eventId === eventId)) return;
  queue.push({
    eventId,
    tid,
    teamName,
    sessionId,
    action,
    payload,
    createdAt: Date.now(),
  });
  writePendingSyncQueue(queue);
}

function removeSyncEvents(eventIds: Set<string>): void {
  if (eventIds.size === 0) return;
  const remaining = readPendingSyncQueue().filter((item) => !eventIds.has(item.eventId));
  writePendingSyncQueue(remaining);
}

async function postWithOutbox(
  payload: Record<string, unknown>,
  timeoutMs = 8000
): Promise<void> {
  if (!hasAppsScriptBackend()) return;
  enqueueSyncEvent(payload);
  const eventId = String(payload.eventId || '');
  try {
    await callAppsScriptPost(payload, timeoutMs);
    if (eventId) removeSyncEvents(new Set([eventId]));
    // Trigger background drain if older retries are waiting
    if (readPendingSyncQueue().length > 0) {
      void flushPendingSyncQueue();
    }
  } catch (err) {
    console.warn(`[Sheets] Queued ${String(payload.action || 'EVENT')} for retry:`, err);
  }
}

export async function flushPendingSyncQueue(): Promise<void> {
  if (!hasAppsScriptBackend() || flushInFlight) return;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return;

  const initialQueue = readPendingSyncQueue();
  if (initialQueue.length === 0) return;

  flushInFlight = true;
  try {
    // Group queued events by (tid/teamName + sessionId) so session binding matches every batch
    const groups = new Map<string, PendingSyncItem[]>();
    initialQueue.forEach((item) => {
      const groupKey = `${item.tid || item.teamName}::${item.sessionId}`;
      const list = groups.get(groupKey) || [];
      list.push(item);
      groups.set(groupKey, list);
    });

    for (const groupItems of groups.values()) {
      const ordered = groupItems.slice().sort((a, b) => {
        const aIsReg = a.action === 'REGISTRATION' ? 0 : 1;
        const bIsReg = b.action === 'REGISTRATION' ? 0 : 1;
        if (aIsReg !== bIsReg) return aIsReg - bIsReg;
        return a.createdAt - b.createdAt;
      });

      const BATCH_SIZE = 25;
      for (let i = 0; i < ordered.length; i += BATCH_SIZE) {
        const chunk = ordered.slice(i, i + BATCH_SIZE);
        const head = chunk[0];
        try {
          await callAppsScriptPost(
            {
              action: 'SESSION_BATCH',
              tid: head.tid,
              teamName: head.teamName,
              sessionId: head.sessionId,
              events: chunk.map((c) => c.payload),
            },
            15000
          );
          removeSyncEvents(new Set(chunk.map((c) => c.eventId)));
        } catch {
          // Stop batching on transient error; items stay safely in outbox
          return;
        }
      }
    }
  } finally {
    flushInFlight = false;
  }
}

export function startOutboxSyncLoop(): () => void {
  const handleOnline = () => {
    void flushPendingSyncQueue();
  };
  const initialTimer = window.setTimeout(() => {
    void flushPendingSyncQueue();
  }, 1500);
  const intervalId = window.setInterval(() => {
    void flushPendingSyncQueue();
  }, 12000);
  window.addEventListener('online', handleOnline);

  return () => {
    window.clearTimeout(initialTimer);
    window.clearInterval(intervalId);
    window.removeEventListener('online', handleOnline);
  };
}


// ==========================================
// STRING & PUZZLE HELPERS
// ==========================================
export function standardizeString(str: unknown): string {
  return String(str ?? '').trim().toUpperCase();
}

export function generateSessionId(): string {
  return `SES_${Date.now()}_${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
}

export function generateEventId(): string {
  return `evt_${Date.now()}_${Math.random().toString(36).substring(2, 10)}`;
}

export function toFirestoreLanguage(lang: LanguageCode | string): FirestoreLanguage {
  return standardizeString(lang) === 'CPP' || standardizeString(lang) === 'C++' ? 'C++' : 'PYTHON';
}

export function fromFirestoreLanguage(lang: string): LanguageCode {
  return standardizeString(lang) === 'C++' || standardizeString(lang) === 'CPP' ? 'CPP' : 'PYTHON';
}

export function isStartingPuzzle(puzzle: Puzzle | null | undefined): boolean {
  if (!puzzle) return false;
  if (puzzle.requiresStartCode === false) return false;
  return Boolean(puzzle.startCode && String(puzzle.startCode).trim() !== '');
}

export function isHintValid(hint: unknown): boolean {
  if (hint === null || hint === undefined) return false;
  if (typeof hint === 'boolean') return hint === true;
  if (typeof hint === 'string') {
    const lower = hint.toLowerCase().trim();
    return lower !== 'none' && lower !== 'false' && lower !== '' && lower !== 'null';
  }
  return false;
}

export function puzzleHasHint(puzzle: Puzzle | null | undefined): boolean {
  if (!puzzle) return false;
  if (puzzle.hasHint === true) return true;
  return isHintValid(puzzle.hint);
}

export function getPuzzleQuestion(puzzle: Puzzle | null, language: LanguageCode): string {
  if (!puzzle) return '';
  if (language === 'CPP') return puzzle.questionCpp || puzzle.questionPython || '';
  return puzzle.questionPython || puzzle.questionCpp || '';
}

export function getPokemonArtworkUrl(pokemonId: number | string | undefined): string {
  const id = Number(pokemonId);
  if (!id || Number.isNaN(id)) return '/assets/img/pikachu.png';
  return `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/${id}.png`;
}

export function getBadgeUrl(badgeId: number | string | undefined): string {
  const id = Number(badgeId);
  if (!id || Number.isNaN(id)) return '';
  return `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/badges/${id}.png`;
}

export function computeLocalUnlocked(puzzles: Puzzle[], solvedIds: number[]): number[] {
  const byId = new Map<number, Puzzle>();
  const allowed = new Set<number>();
  puzzles.forEach((p) => {
    const id = Number(p.id);
    byId.set(id, p);
    if (isStartingPuzzle(p)) allowed.add(id);
  });
  solvedIds.forEach((rawId) => {
    const p = byId.get(Number(rawId));
    if (!p) return;
    allowed.add(Number(p.id));
    (p.nextPuzzleId || []).forEach((n) => allowed.add(Number(n)));
  });
  return Array.from(allowed).sort((a, b) => a - b);
}

export function isPuzzleAllowed(
  puzzle: Puzzle | null | undefined,
  solvedIds: Set<number>,
  unlockedIds: Set<number>
): boolean {
  if (!puzzle) return false;
  if (isStartingPuzzle(puzzle)) return true;
  const id = Number(puzzle.id);
  return solvedIds.has(id) || unlockedIds.has(id);
}

export function puzzleGateMessage(
  puzzle: Puzzle | null | undefined,
  puzzles: Puzzle[],
  currentPuzzle: Puzzle | null
): string {
  if (!puzzle) return '❌ Invalid Signal - Access Denied';
  const prereqs = puzzles.filter(
    (p) => Array.isArray(p.nextPuzzleId) && p.nextPuzzleId.some((n) => Number(n) === Number(puzzle.id))
  );
  if (prereqs.length > 0) {
    const prev = prereqs[0];
    if (!currentPuzzle) {
      return `🔒 Locked! Solve ${prev.linkid || 'the previous puzzle'} first.`;
    }
    return `🔒 Out of sequence! Finish Puzzle ${currentPuzzle.id} first.`;
  }
  return `🔒 Locked! Scan ${currentPuzzle ? currentPuzzle.linkid : 'the starting QR'} first.`;
}

export function getNextPuzzles(puzzles: Puzzle[], puzzle: Puzzle | null): Puzzle[] {
  if (!puzzle || !Array.isArray(puzzle.nextPuzzleId)) return [];
  return puzzle.nextPuzzleId
    .map((id) => puzzles.find((p) => Number(p.id) === Number(id)))
    .filter((p): p is Puzzle => Boolean(p));
}

export function resolveUniversalLink(
  puzzles: Puzzle[],
  memes: MemeEntry[]
): { puzzle: Puzzle | null; meme: MemeEntry | null } {
  const params = new URLSearchParams(window.location.search);
  let linkId = standardizeString(params.get('linkid'));
  let memeId = standardizeString(params.get('memid'));

  if (!linkId && !memeId) {
    const seg = (window.location.pathname || '').split('/').filter(Boolean).pop();
    if (seg && standardizeString(seg) !== 'ADMIN') {
      const std = standardizeString(seg);
      if (memes.some((m) => standardizeString(m.memeid) === std)) {
        memeId = std;
      } else if (puzzles.some((p) => standardizeString(p.linkid) === std)) {
        linkId = std;
      }
    }
  }

  const puzzle = linkId ? puzzles.find((p) => standardizeString(p.linkid) === linkId) || null : null;
  const meme = memeId ? memes.find((m) => standardizeString(m.memeid) === memeId) || null : null;
  return { puzzle, meme };
}

// ==========================================
// LOCAL JSON LOADERS + O(1) IN-MEMORY INDEX
// ==========================================
export const DEFAULT_GAME_CONFIG: GameConfig = {
  languages: [
    { value: 'PYTHON', label: 'PYTHON', icon: 'assets/img/python.png' },
    { value: 'CPP', label: 'C++', icon: 'assets/img/C++.png' },
  ],
  missionTypes: [
    { value: 'GRASS', label: 'GRASS', icon: 'assets/img/grass.png' },
    { value: 'FIRE', label: 'FIRE', icon: 'assets/img/fire.png' },
    { value: 'WATER', label: 'WATER', icon: 'assets/img/water.png' },
    { value: 'GROUND', label: 'GROUND', icon: 'assets/img/ground.png' },
    { value: 'GHOST', label: 'GHOST', icon: 'assets/img/ghost.png' },
    { value: 'FAIRY', label: 'FAIRY', icon: 'assets/img/fairy.png' },
    { value: 'PIKACHU', label: 'PIKACHU', icon: 'assets/img/pikachu.png' },
  ],
  missionGroups: [
    {
      label: 'LEVEL 1: ELEMENTAL',
      level: 'L1',
      labelClass: 'text-blue-400',
      missions: [
        { value: 'L1_GRASS', label: 'GRASS SECTOR', icon: 'assets/img/grass.png' },
        { value: 'L1_FIRE', label: 'FIRE SECTOR', icon: 'assets/img/fire.png' },
        { value: 'L1_WATER', label: 'WATER SECTOR', icon: 'assets/img/water.png' },
        { value: 'L1_GROUND', label: 'GROUND SECTOR', icon: 'assets/img/ground.png' },
      ],
    },
    {
      label: 'LEVEL 2: ELITE',
      level: 'L2',
      labelClass: 'text-yellow-500',
      missions: [
        { value: 'L2_GHOST', label: 'GHOST ASCENT', icon: 'assets/img/ghost.png' },
        { value: 'L2_FAIRY', label: 'FAIRY STRIKE', icon: 'assets/img/fairy.png' },
      ],
    },
    {
      label: 'LEVEL 3: ULTIMATE',
      level: 'L3',
      labelClass: 'text-red-500',
      missions: [
        { value: 'L3_PIKACHU', label: 'PIKACHU GO', icon: 'assets/img/pikachu.png' },
      ],
    },
  ],
};

function normalizeLoadedPuzzle(raw: Partial<Puzzle>, isCustom = false): Puzzle {
  const id = Math.max(1, Math.floor(Number(raw.id || 1)));
  const rawHint = typeof raw.hint === 'string' ? raw.hint.trim() : raw.hint;
  const hasHintFlag =
    typeof raw.hasHint === 'boolean' ? raw.hasHint : isHintValid(rawHint);
  const startCodeVal = raw.startCode ? String(raw.startCode).trim() : undefined;
  return {
    id,
    linkid: String(raw.linkid || `P${id}`).trim(),
    badgeId: raw.badgeId && Number(raw.badgeId) > 0 ? Number(raw.badgeId) : undefined,
    questionPython: String(raw.questionPython || ''),
    questionCpp: String(raw.questionCpp || ''),
    answer: String(raw.answer ?? ''),
    nextPuzzleId: Array.isArray(raw.nextPuzzleId)
      ? raw.nextPuzzleId.map(Number).filter((n) => !Number.isNaN(n) && n > 0)
      : [],
    startCode: startCodeVal,
    requiresStartCode:
      typeof raw.requiresStartCode === 'boolean'
        ? raw.requiresStartCode
        : Boolean(startCodeVal),
    locationClue: String(raw.locationClue || ''),
    level: Math.max(1, Math.floor(Number(raw.level || 1))),
    points: Math.max(0, Number(raw.points ?? 10)),
    hint: isHintValid(rawHint) ? rawHint : undefined,
    hasHint: hasHintFlag,
    hintPenalty: raw.hintPenalty !== undefined ? Number(raw.hintPenalty) : 60,
    pokemonId: Math.max(0, Math.floor(Number(raw.pokemonId ?? 25))),
    pokemonName: String(raw.pokemonName || 'Pikachu'),
    isCustom,
  };
}

interface LocalCatalogOverrides {
  teamsUpsert: Record<string, TeamEntry>;
  teamsDelete: string[];
  memesUpsert: Record<string, MemeEntry>;
  memesDelete: string[];
  puzzlesUpsert: Record<string, Puzzle>;
  puzzlesDelete: number[];
  catalogVersion: number;
}

function readLocalOverrides(): LocalCatalogOverrides {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.localCatalogOverrides);
    if (raw) {
      const p = JSON.parse(raw) as Partial<LocalCatalogOverrides>;
      return {
        teamsUpsert: p.teamsUpsert || {},
        teamsDelete: Array.isArray(p.teamsDelete) ? p.teamsDelete : [],
        memesUpsert: p.memesUpsert || {},
        memesDelete: Array.isArray(p.memesDelete) ? p.memesDelete : [],
        puzzlesUpsert: p.puzzlesUpsert || {},
        puzzlesDelete: Array.isArray(p.puzzlesDelete) ? p.puzzlesDelete.map(Number) : [],
        catalogVersion: Math.max(1, Number(p.catalogVersion || 1)),
      };
    }
  } catch {
    // ignore
  }
  return {
    teamsUpsert: {},
    teamsDelete: [],
    memesUpsert: {},
    memesDelete: [],
    puzzlesUpsert: {},
    puzzlesDelete: [],
    catalogVersion: 1,
  };
}

function writeLocalOverrides(next: LocalCatalogOverrides): void {
  try {
    localStorage.setItem(STORAGE_KEYS.localCatalogOverrides, JSON.stringify(next));
  } catch {
    // ignore
  }
}

async function fetchJsonSafe<T>(path: string, fallback: T): Promise<T> {
  try {
    const res = await fetch(path, { cache: 'no-cache' });
    if (!res.ok) return fallback;
    return (await res.json()) as T;
  } catch {
    return fallback;
  }
}

interface CatalogCacheBlob {
  version: number;
  epoch?: number;
  puzzles: Puzzle[];
  memes: MemeEntry[];
  config: GameConfig;
}

function readCatalogCache(): CatalogCacheBlob | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.catalogCache);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CatalogCacheBlob;
    if (!parsed || typeof parsed.version !== 'number' || !Array.isArray(parsed.puzzles)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function readCachedPlayerCatalog(): {
  puzzles: Puzzle[];
  memes: MemeEntry[];
  config: GameConfig;
  catalogVersion: number;
  epoch: number;
} | null {
  const cached = readCatalogCache();
  if (!cached || cached.puzzles.length === 0) return null;
  return {
    puzzles: cached.puzzles,
    memes: cached.memes || [],
    config: cached.config || DEFAULT_GAME_CONFIG,
    catalogVersion: cached.version,
    epoch: Math.max(1, Number(cached.epoch || 1)),
  };
}

function writeCatalogCache(blob: CatalogCacheBlob): void {
  try {
    localStorage.setItem(STORAGE_KEYS.catalogCache, JSON.stringify(blob));
  } catch {
    // ignore storage quota errors
  }
}

export function clearCatalogCache(): void {
  try {
    localStorage.removeItem(STORAGE_KEYS.catalogCache);
  } catch {
    // ignore
  }
}

// Fast O(1) in-memory team cache populated from /data/teams.json
let teamsMemoryCache: TeamEntry[] | null = null;
let teamsByTidCache = new Map<string, TeamEntry>();
let teamsByNameLowerCache = new Map<string, TeamEntry>();

function rebuildTeamsIndex(teams: TeamEntry[]): void {
  teamsMemoryCache = teams;
  teamsByTidCache = new Map();
  teamsByNameLowerCache = new Map();
  teams.forEach((t) => {
    if (t.tid) teamsByTidCache.set(t.tid.toUpperCase(), t);
    if (t.team) teamsByNameLowerCache.set(t.team.toLowerCase(), t);
  });
}

async function loadMergedTeams(): Promise<TeamEntry[]> {
  const baseTeams = await fetchJsonSafe<Partial<TeamEntry>[]>('/data/teams.json', []);
  const overrides = readLocalOverrides();
  const deletedSet = new Set(overrides.teamsDelete.map((s) => s.toUpperCase()));
  const mergedMap = new Map<string, TeamEntry>();

  baseTeams.forEach((t) => {
    const tid = String(t.tid || '').trim().toUpperCase();
    const team = String(t.team || '').trim();
    if (!tid || !team || deletedSet.has(tid)) return;
    mergedMap.set(tid, {
      tid,
      team,
      securityKey: String(t.securityKey || ''),
      team_members: Array.isArray(t.team_members) ? t.team_members.map(String) : [],
      isCustom: false,
    });
  });

  Object.values(overrides.teamsUpsert).forEach((t) => {
    const tid = String(t.tid || '').trim().toUpperCase();
    if (!tid || deletedSet.has(tid)) return;
    mergedMap.set(tid, { ...t, tid, isCustom: true });
  });

  const sorted = Array.from(mergedMap.values()).sort((a, b) =>
    a.tid.localeCompare(b.tid, undefined, { numeric: true })
  );
  rebuildTeamsIndex(sorted);
  return sorted;
}

export async function fetchGameMeta(): Promise<{
  epoch: number;
  catalogVersion: number;
  catalogInitialized: boolean;
}> {
  const localEpoch = Math.max(1, Number(localStorage.getItem(STORAGE_KEYS.gameEpoch) || 1));
  const localOverrides = readLocalOverrides();
  if (hasAppsScriptBackend()) {
    try {
      const remote = await callAppsScriptGet('GET_EPOCH', {}, 3500);
      const remoteEpoch = Array.isArray(remote) ? 1 : Number(remote?.epoch || 1);
      return {
        epoch: Math.max(localEpoch, Number.isFinite(remoteEpoch) && remoteEpoch >= 1 ? Math.floor(remoteEpoch) : 1),
        catalogVersion: localOverrides.catalogVersion,
        catalogInitialized: true,
      };
    } catch {
      // fall through cleanly to local JSON meta
    }
  }
  return {
    epoch: localEpoch,
    catalogVersion: localOverrides.catalogVersion,
    catalogInitialized: true,
  };
}

/**
 * Fast JSON-first player catalog loader:
 * - Reads `/data/config.json`, `/data/meme.json`, `/data/puzzle.json` directly in ~2ms!
 * - Applies any local Admin Studio edits/additions from localStorage.
 * - Preloads `/data/teams.json` into O(1) Map for instant team login.
 */
export async function loadPlayerCatalog(forceRefresh = false): Promise<{
  puzzles: Puzzle[];
  memes: MemeEntry[];
  config: GameConfig;
  catalogVersion: number;
  epoch: number;
}> {
  const localEpoch = Math.max(1, Number(localStorage.getItem(STORAGE_KEYS.gameEpoch) || 1));
  const overrides = readLocalOverrides();

  const [rawConfig, rawMemes, rawPuzzles] = await Promise.all([
    fetchJsonSafe<Partial<GameConfig>>('/data/config.json', DEFAULT_GAME_CONFIG),
    fetchJsonSafe<Partial<MemeEntry>[]>('/data/meme.json', []),
    fetchJsonSafe<Partial<Puzzle>[]>('/data/puzzle.json', []),
  ]);

  const config: GameConfig =
    rawConfig && Array.isArray(rawConfig.languages) && Array.isArray(rawConfig.missionGroups)
      ? {
          languages: rawConfig.languages,
          missionTypes: rawConfig.missionTypes || DEFAULT_GAME_CONFIG.missionTypes,
          missionGroups: rawConfig.missionGroups,
        }
      : DEFAULT_GAME_CONFIG;

  const deletedMemes = new Set(overrides.memesDelete.map((m) => m.toUpperCase()));
  const memesMap = new Map<string, MemeEntry>();
  (rawMemes || []).forEach((m) => {
    const memeid = String(m.memeid || '').trim().toUpperCase();
    const ytlink = String(m.ytlink || '').trim();
    if (!memeid || !ytlink || deletedMemes.has(memeid)) return;
    memesMap.set(memeid, {
      memeid,
      ytlink,
      starttime: Number(m.starttime || 0),
      endtime: Number(m.endtime || 0),
      isCustom: false,
    });
  });
  Object.values(overrides.memesUpsert).forEach((m) => {
    const memeid = String(m.memeid || '').trim().toUpperCase();
    if (!memeid || deletedMemes.has(memeid)) return;
    memesMap.set(memeid, { ...m, memeid, isCustom: true });
  });
  const memes = Array.from(memesMap.values()).sort((a, b) =>
    a.memeid.localeCompare(b.memeid, undefined, { numeric: true })
  );

  const deletedPuzzles = new Set(overrides.puzzlesDelete);
  const puzzlesMap = new Map<number, Puzzle>();
  (rawPuzzles || []).forEach((p) => {
    const norm = normalizeLoadedPuzzle(p, false);
    if (!deletedPuzzles.has(norm.id)) puzzlesMap.set(norm.id, norm);
  });
  Object.values(overrides.puzzlesUpsert).forEach((p) => {
    const norm = normalizeLoadedPuzzle(p, true);
    if (!deletedPuzzles.has(norm.id)) puzzlesMap.set(norm.id, norm);
  });
  const puzzles = Array.from(puzzlesMap.values()).sort((a, b) => a.id - b.id);

  // Warm teams O(1) lookup index in background for zero-latency login
  void loadMergedTeams();

  if (puzzles.length > 0 || forceRefresh) {
    writeCatalogCache({
      version: overrides.catalogVersion,
      epoch: localEpoch,
      puzzles,
      memes,
      config,
    });
  }

  return {
    puzzles,
    memes,
    config,
    catalogVersion: overrides.catalogVersion,
    epoch: localEpoch,
  };
}

/**
 * O(1) JSON-indexed lookup for a team by TID or Team Name (~0.1ms).
 */
export async function authenticateTeamFromDb(teamOrTidInput: string): Promise<TeamEntry | null> {
  const raw = teamOrTidInput.trim();
  if (!raw) return null;

  if (!teamsMemoryCache || teamsMemoryCache.length === 0) {
    await loadMergedTeams();
  }

  const upperTid = sanitizeCatalogId(raw.toUpperCase(), 32);
  const lowerName = raw.toLowerCase();

  return teamsByTidCache.get(upperTid) || teamsByNameLowerCache.get(lowerName) || null;
}

export async function loadAdminCatalog(_adminKey?: string): Promise<{
  puzzles: Puzzle[];
  teams: TeamEntry[];
  memes: MemeEntry[];
  config: GameConfig;
  catalogInitialized: boolean;
}> {
  const [playerCat, teams] = await Promise.all([loadPlayerCatalog(true), loadMergedTeams()]);
  return {
    puzzles: playerCat.puzzles,
    teams,
    memes: playerCat.memes,
    config: playerCat.config,
    catalogInitialized: true,
  };
}

// ==========================================
// LOCAL STORAGE & NOTEBOOK HELPERS
// ==========================================
export interface RememberedTeamInfo {
  teamName: string;
  tid: string;
  mission: string;
  language: LanguageCode;
}

export interface SavedGameState {
  currentStep: StepId;
  currentTeam: string;
  currentTeamTid: string;
  currentMissionLevel: string;
  currentLanguage: LanguageCode;
  sessionId: string;
  tabSwitchCount: number;
  currentPuzzleId: number | null;
  terminalLocked?: boolean;
}

export function getRememberedTeamInfo(): RememberedTeamInfo | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.teamInfo);
    return raw ? (JSON.parse(raw) as RememberedTeamInfo) : null;
  } catch {
    return null;
  }
}

export function saveRememberedTeamInfo(info: RememberedTeamInfo): void {
  try {
    localStorage.setItem(STORAGE_KEYS.teamInfo, JSON.stringify(info));
  } catch {
    // ignore storage errors
  }
}

export function getSavedGameState(): Partial<SavedGameState> {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEYS.gameState) || '{}') as Partial<SavedGameState>;
  } catch {
    return {};
  }
}

export function saveGameStateLocal(state: SavedGameState): void {
  try {
    localStorage.setItem(STORAGE_KEYS.gameState, JSON.stringify(state));
  } catch {
    // ignore
  }
}

export function clearGameStateLocal(): void {
  try {
    localStorage.removeItem(STORAGE_KEYS.gameState);
  } catch {
    // ignore
  }
}

export function wipeAllLocalGameStorage(newEpoch?: number): void {
  try {
    const preserve = new Set<string>([
      STORAGE_KEYS.gameEpoch,
      STORAGE_KEYS.localCatalogOverrides,
      STORAGE_KEYS.adminSessionKey,
    ]);
    Object.values(STORAGE_KEYS).forEach((key) => {
      if (!preserve.has(key)) {
        localStorage.removeItem(key);
      }
    });
    const keysToDelete: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (
        k &&
        (k.startsWith(STORAGE_KEYS.scoreState) ||
          k.startsWith(STORAGE_KEYS.puzzleNotebook) ||
          k.startsWith(STORAGE_KEYS.localTeamProgress))
      ) {
        keysToDelete.push(k);
      }
    }
    keysToDelete.forEach((k) => localStorage.removeItem(k));
    if (typeof newEpoch === 'number' && newEpoch >= 1) {
      localStorage.setItem(STORAGE_KEYS.gameEpoch, String(newEpoch));
    }
  } catch {
    // ignore
  }
}

export function getTeamScoreStateLocal(teamKey: string): {
  score: number;
  solved: number[];
  unlocked: number[];
  hintsUsed: number[];
} {
  try {
    const raw = localStorage.getItem(`${STORAGE_KEYS.scoreState}:${teamKey}`);
    if (!raw) return { score: 0, solved: [], unlocked: [], hintsUsed: [] };
    const parsed = JSON.parse(raw);
    return {
      score: Number(parsed.score || 0),
      solved: Array.isArray(parsed.solved) ? parsed.solved.map(Number) : [],
      unlocked: Array.isArray(parsed.unlocked) ? parsed.unlocked.map(Number) : [],
      hintsUsed: Array.isArray(parsed.hintsUsed) ? parsed.hintsUsed.map(Number) : [],
    };
  } catch {
    return { score: 0, solved: [], unlocked: [], hintsUsed: [] };
  }
}

export function saveTeamScoreStateLocal(
  teamKey: string,
  state: { score: number; solved: number[]; unlocked: number[]; hintsUsed: number[] }
): void {
  if (!teamKey) return;
  try {
    localStorage.setItem(`${STORAGE_KEYS.scoreState}:${teamKey}`, JSON.stringify(state));
  } catch {
    // ignore
  }
}

export function getHintUsedLocal(teamName: string, puzzleId: number): boolean {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEYS.hintState) || '{}');
    const entry = raw[`${teamName}_${puzzleId}`];
    return Boolean(entry && entry.used);
  } catch {
    return false;
  }
}

export function saveHintUsedLocal(teamName: string, puzzleId: number): void {
  if (!teamName || !puzzleId) return;
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEYS.hintState) || '{}');
    raw[`${teamName}_${puzzleId}`] = {
      used: true,
      usedAt: new Date().toISOString(),
      team: teamName,
      puzzleId,
    };
    localStorage.setItem(STORAGE_KEYS.hintState, JSON.stringify(raw));
  } catch {
    // ignore
  }
}

function getNotebookStorageKey(teamKey: string): string {
  return `${STORAGE_KEYS.puzzleNotebook}${teamKey ? `:${teamKey}` : ''}`;
}

export function getPuzzleNotebook(teamKey: string): Record<string, PuzzleNotebookEntry> {
  try {
    return JSON.parse(localStorage.getItem(getNotebookStorageKey(teamKey)) || '{}') as Record<
      string,
      PuzzleNotebookEntry
    >;
  } catch {
    return {};
  }
}

export function savePuzzleNotebook(teamKey: string, notebook: Record<string, PuzzleNotebookEntry>): void {
  try {
    localStorage.setItem(getNotebookStorageKey(teamKey), JSON.stringify(notebook));
  } catch {
    // ignore
  }
}

export function deletePuzzleNotebookEntry(teamKey: string, puzzleId: number): void {
  const nb = getPuzzleNotebook(teamKey);
  delete nb[String(puzzleId)];
  savePuzzleNotebook(teamKey, nb);
}

export function createNotebookEntry(
  notebook: Record<string, PuzzleNotebookEntry>,
  puzzle: Puzzle
): PuzzleNotebookEntry {
  const entry: PuzzleNotebookEntry = {
    puzzleId: puzzle.id,
    linkid: puzzle.linkid,
    level: puzzle.level,
    startedAt: Date.now(),
    unlockedAt: null,
    scanCount: 0,
    wrongAttempts: 0,
    hintsUsed: 0,
    tabSwitches: 0,
    solvedAt: null,
    dirty: false,
    lastActivityAt: Date.now(),
  };
  notebook[String(puzzle.id)] = entry;
  return entry;
}

export function notepadStartLocal(teamKey: string, puzzle: Puzzle | null): void {
  if (!teamKey || !puzzle) return;
  const nb = getPuzzleNotebook(teamKey);
  const key = String(puzzle.id);
  const n = nb[key] || createNotebookEntry(nb, puzzle);
  n.unlockedAt = n.unlockedAt || Date.now();
  n.lastActivityAt = Date.now();
  n.dirty = true;
  savePuzzleNotebook(teamKey, nb);
}

export function notepadBumpLocal(
  teamKey: string,
  field: 'scan' | 'wrong' | 'hint' | 'tabswitch',
  puzzle: Puzzle | null
): PuzzleNotebookEntry | null {
  if (!teamKey || !puzzle) return null;
  const nb = getPuzzleNotebook(teamKey);
  const key = String(puzzle.id);
  const n = nb[key] || createNotebookEntry(nb, puzzle);
  if (field === 'scan') n.scanCount += 1;
  else if (field === 'wrong') n.wrongAttempts += 1;
  else if (field === 'hint') n.hintsUsed += 1;
  else if (field === 'tabswitch') n.tabSwitches += 1;
  n.lastActivityAt = Date.now();
  n.dirty = true;
  savePuzzleNotebook(teamKey, nb);
  return n;
}

// ==========================================
// LOCAL 4-SHEET TELEMETRY + APPS SCRIPT SYNC
// ==========================================
export interface NormalizedAdminLogRow {
  id: string;
  action: string;
  level: string;
  tid: string;
  teamName: string;
  mission: string;
  language: string;
  sessionId: string;
  puzzleId: number;
  linkid: string;
  status: string;
  wrongAttempts: number;
  tabSwitches: number;
  hintUsed: boolean;
  scanCount: number;
  pointsEarned: number;
  pointsLost: number;
  points: number;
  totalScore: number;
  unlockedPuzzles: string;
  solvedPuzzles?: string;
  timestamp: string;
  lastActive: string;
  registeredAt: string;
}

function readLocalTelemetryLogs(): NormalizedAdminLogRow[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.localLogs);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as NormalizedAdminLogRow[]) : [];
  } catch {
    return [];
  }
}

function writeLocalTelemetryLogs(logs: NormalizedAdminLogRow[]): void {
  try {
    // Cap at 15,000 rows to safeguard localStorage quota (300 teams × 40 puzzles = ~12,000)
    const trimmed = logs.length > 15000 ? logs.slice(logs.length - 15000) : logs;
    localStorage.setItem(STORAGE_KEYS.localLogs, JSON.stringify(trimmed));
  } catch {
    // ignore storage quota errors
  }
}

function upsertLocalRegistrationRow(row: NormalizedAdminLogRow): void {
  const logs = readLocalTelemetryLogs();
  const key = `reg_${row.tid.toUpperCase()}`;
  const idx = logs.findIndex((l) => l.id === key);
  const entry: NormalizedAdminLogRow = { ...row, id: key, action: 'REGISTRATION', level: 'REG' };
  if (idx >= 0) {
    logs[idx] = {
      ...logs[idx],
      ...entry,
      registeredAt: logs[idx].registeredAt || entry.registeredAt,
    };
  } else {
    logs.push(entry);
  }
  writeLocalTelemetryLogs(logs);
}

function upsertLocalLevelSummaryRow(
  row: NormalizedAdminLogRow,
  mode: 'telemetry' | 'solve' | 'repeat' | 'abandon'
): void {
  if (!row.puzzleId || row.puzzleId <= 0) return;
  const logs = readLocalTelemetryLogs();
  const lvl = toLevelTag(row.level);
  const tid = row.tid.toUpperCase();

  if (mode === 'repeat') {
    logs.push({
      ...row,
      id: `${lvl}_${tid}_P${row.puzzleId}_repeat_${row.id}`,
      action: 'SUMMARY',
      level: lvl,
      status: 'REPEAT_SOLVE',
    });
    writeLocalTelemetryLogs(logs);
    return;
  }

  const anchorId = `${lvl}_${tid}_P${row.puzzleId}`;
  const idx = logs.findIndex((l) => l.id === anchorId);

  if (idx >= 0) {
    const prev = logs[idx];
    const alreadySolved = String(prev.status || '').toUpperCase() === 'SOLVED';
    if (alreadySolved && mode !== 'solve') {
      // Sealed anchor row: only counter increments on telemetry are kept
      logs[idx] = {
        ...prev,
        wrongAttempts: Math.max(prev.wrongAttempts, row.wrongAttempts),
        tabSwitches: Math.max(prev.tabSwitches, row.tabSwitches),
        hintUsed: prev.hintUsed || row.hintUsed,
        lastActive: row.timestamp,
      };
    } else if (mode === 'abandon' && prev.status === 'UNSOLVED') {
      logs[idx] = {
        ...prev,
        wrongAttempts: Math.max(prev.wrongAttempts, row.wrongAttempts),
        tabSwitches: Math.max(prev.tabSwitches, row.tabSwitches),
        hintUsed: prev.hintUsed || row.hintUsed,
        timestamp: row.timestamp,
        lastActive: row.timestamp,
      };
    } else {
      logs[idx] = {
        ...prev,
        ...row,
        id: anchorId,
        action: 'SUMMARY',
        level: lvl,
        wrongAttempts: Math.max(prev.wrongAttempts, row.wrongAttempts),
        tabSwitches: Math.max(prev.tabSwitches, row.tabSwitches),
        hintUsed: prev.hintUsed || row.hintUsed,
        status: mode === 'solve' ? 'SOLVED' : prev.status === 'SOLVED' ? 'SOLVED' : 'UNSOLVED',
      };
    }
  } else {
    logs.push({
      ...row,
      id: anchorId,
      action: 'SUMMARY',
      level: lvl,
      status: mode === 'solve' ? 'SOLVED' : 'UNSOLVED',
    });
  }
  writeLocalTelemetryLogs(logs);
}

function readLocalTeamProgress(tid: string): TeamProgressDoc | null {
  try {
    const raw = localStorage.getItem(`${STORAGE_KEYS.localTeamProgress}:${tid.toUpperCase()}`);
    return raw ? (JSON.parse(raw) as TeamProgressDoc) : null;
  } catch {
    return null;
  }
}

function writeLocalTeamProgress(progress: TeamProgressDoc): void {
  try {
    localStorage.setItem(
      `${STORAGE_KEYS.localTeamProgress}:${progress.tid.toUpperCase()}`,
      JSON.stringify(progress)
    );
  } catch {
    // ignore
  }
}

export async function fetchServerGameEpoch(): Promise<number> {
  const meta = await fetchGameMeta();
  return meta.epoch;
}

function toLevelTag(levelNum: number | string | undefined): 'REG' | 'L1' | 'L2' | 'L3' {
  const raw = String(levelNum ?? '').toUpperCase().trim();
  if (raw === 'REG') return 'REG';
  if (raw === 'L1' || raw === '1') return 'L1';
  if (raw === 'L2' || raw === '2') return 'L2';
  if (raw === 'L3' || raw === '3') return 'L3';
  const digits = raw.replace(/\D/g, '');
  if (digits === '2') return 'L2';
  if (digits === '3') return 'L3';
  return 'L1';
}

function toNumericLevel(levelNum: number | string | undefined, mission?: string): number {
  const tag = toLevelTag(levelNum || mission);
  if (tag === 'L2') return 2;
  if (tag === 'L3') return 3;
  return 1;
}

export async function syncTeamRegistrationToDb(params: {
  tid: string;
  teamName: string;
  mission: string;
  language: LanguageCode;
  sessionId: string;
  puzzles: Puzzle[];
  serverEpochOverride?: number;
}): Promise<{
  epoch: number;
  teamProgress: TeamProgressDoc;
}> {
  const { tid, teamName, mission, language, sessionId, puzzles } = params;
  const cleanTid = tid.trim().toUpperCase().slice(0, 32);
  const cleanTeam = teamName.trim().slice(0, 60);
  const cleanMission = mission.trim().slice(0, 40);
  const fsLang = toFirestoreLanguage(language);
  const nowIso = new Date().toISOString();
  const localEpoch = Math.max(
    1,
    Number(params.serverEpochOverride || localStorage.getItem(STORAGE_KEYS.gameEpoch) || 1)
  );
  if (!localStorage.getItem(STORAGE_KEYS.gameEpoch)) {
    localStorage.setItem(STORAGE_KEYS.gameEpoch, String(localEpoch));
  }

  const starterUnlocked = computeLocalUnlocked(puzzles, []);
  const existing = readLocalTeamProgress(cleanTid);
  const scoreBackup = getTeamScoreStateLocal(cleanTid);
  const sameEpochExisting = existing && existing.epoch === localEpoch ? existing : null;

  let solved = sameEpochExisting?.solved || scoreBackup.solved || [];
  let hintsUsed = sameEpochExisting?.hintsUsed || scoreBackup.hintsUsed || [];
  let score = sameEpochExisting?.score ?? scoreBackup.score ?? 0;
  let tabSwitches = sameEpochExisting?.tabSwitches ?? 0;
  let currentPuzzle = sameEpochExisting?.currentPuzzle ?? 0;

  // Optionally restore cross-device team progress from Google Sheets if configured
  if (hasAppsScriptBackend()) {
    try {
      const remoteState = await callAppsScriptPost(
        {
          action: 'GET_TEAM_STATE',
          tid: cleanTid,
          teamName: cleanTeam,
          sessionId: sessionId.trim().slice(0, 64),
        },
        3000
      );
      const remoteEpoch = Number(remoteState.epoch || localEpoch);
      if (remoteEpoch === localEpoch) {
        const remoteSolved = Array.isArray(remoteState.solved)
          ? remoteState.solved.map(Number).filter((n) => !Number.isNaN(n) && n > 0)
          : [];
        const remoteHints = Array.isArray(remoteState.hintsUsed)
          ? remoteState.hintsUsed.map(Number).filter((n) => !Number.isNaN(n) && n > 0)
          : [];
        if (remoteSolved.length > 0) {
          solved = Array.from(new Set([...solved, ...remoteSolved])).sort((a, b) => a - b);
        }
        if (remoteHints.length > 0) {
          hintsUsed = Array.from(new Set([...hintsUsed, ...remoteHints])).sort((a, b) => a - b);
        }
        if (typeof remoteState.score === 'number' && remoteSolved.length >= solved.length) {
          score = Math.max(score, remoteState.score);
        }
        if (typeof remoteState.tabSwitches === 'number') {
          tabSwitches = Math.max(tabSwitches, remoteState.tabSwitches);
        }
        if (typeof remoteState.currentPuzzle === 'number' && remoteState.currentPuzzle > 0) {
          currentPuzzle = currentPuzzle || remoteState.currentPuzzle;
        }
      }
    } catch {
      // Non-blocking: proceed with fast local state if offline or slow
    }
  }

  const unlocked = Array.from(
    new Set([
      ...starterUnlocked,
      ...computeLocalUnlocked(puzzles, solved),
      ...(sameEpochExisting?.unlocked || scoreBackup.unlocked || []),
    ])
  ).sort((a, b) => a - b);

  const teamProgress: TeamProgressDoc = {
    tid: cleanTid,
    teamName: cleanTeam,
    mission: cleanMission,
    language: fsLang,
    sessionId,
    score,
    solved,
    unlocked,
    hintsUsed,
    currentPuzzle,
    tabSwitches,
    epoch: localEpoch,
    registeredAt: sameEpochExisting?.registeredAt || nowIso,
    updatedAt: nowIso,
  };

  writeLocalTeamProgress(teamProgress);

  const eventId = generateEventId();
  upsertLocalRegistrationRow({
    id: eventId,
    action: 'REGISTRATION',
    level: 'REG',
    tid: cleanTid,
    teamName: cleanTeam,
    mission: cleanMission,
    language: fsLang,
    sessionId,
    puzzleId: 0,
    linkid: '',
    status: 'REGISTERED',
    wrongAttempts: 0,
    tabSwitches: 0,
    hintUsed: false,
    scanCount: 0,
    pointsEarned: 0,
    pointsLost: 0,
    points: 0,
    totalScore: score,
    unlockedPuzzles: unlocked.join(','),
    solvedPuzzles: solved.join(','),
    timestamp: nowIso,
    lastActive: nowIso,
    registeredAt: teamProgress.registeredAt || nowIso,
  });

  if (hasAppsScriptBackend()) {
    await postWithOutbox(
      {
        action: 'REGISTRATION',
        eventId,
        tid: cleanTid,
        teamName: cleanTeam,
        mission: cleanMission,
        language: fsLang,
        level: String(toNumericLevel(undefined, cleanMission)),
        sessionId: sessionId.trim().slice(0, 64),
        timestamp: nowIso,
      },
      3500
    );
  }

  return { epoch: localEpoch, teamProgress };
}

export async function recordPuzzleSolveToDb(params: {
  tid: string;
  teamName: string;
  mission: string;
  language: LanguageCode;
  sessionId: string;
  puzzle: Puzzle;
  repeat: boolean;
  pointsDelta: number;
  newScore: number;
  solved: number[];
  unlocked: number[];
  hintsUsed: number[];
  tabSwitchesTotal: number;
  notebook?: PuzzleNotebookEntry | null;
  epoch: number;
}): Promise<void> {
  if (!params.tid) return;
  const cleanTid = params.tid.trim().toUpperCase().slice(0, 32);
  const nowIso = new Date().toISOString();
  const fsLang = toFirestoreLanguage(params.language);
  const pointsEarned = params.repeat ? 0 : Math.max(0, params.puzzle.points || 0);
  const pointsLost = params.repeat ? Math.max(0, params.puzzle.points || 0) : 0;
  const eventId = params.notebook?.pendingEventId || generateEventId();
  const wrongAttempts = Math.max(0, Math.floor(params.notebook?.wrongAttempts ?? 0));
  const puzzleTabSwitches = Math.max(0, Math.floor(params.notebook?.tabSwitches ?? 0));
  const hintUsed = Boolean(
    (params.notebook?.hintsUsed ?? 0) > 0 || params.hintsUsed.includes(Number(params.puzzle.id))
  );
  const puzzleLevel = toNumericLevel(params.puzzle.level, params.mission);

  const existing = readLocalTeamProgress(cleanTid);
  writeLocalTeamProgress({
    tid: cleanTid,
    teamName: params.teamName,
    mission: params.mission,
    language: fsLang,
    sessionId: params.sessionId,
    score: params.newScore,
    solved: params.solved,
    unlocked: params.unlocked,
    hintsUsed: params.hintsUsed,
    currentPuzzle: params.puzzle.id,
    tabSwitches: params.tabSwitchesTotal,
    epoch: params.epoch,
    registeredAt: existing?.registeredAt || nowIso,
    updatedAt: nowIso,
  });

  upsertLocalLevelSummaryRow(
    {
      id: eventId,
      action: 'SUMMARY',
      level: toLevelTag(params.puzzle.level),
      tid: cleanTid,
      teamName: params.teamName,
      mission: params.mission,
      language: fsLang,
      sessionId: params.sessionId,
      puzzleId: params.puzzle.id,
      linkid: String(params.puzzle.linkid || ''),
      status: params.repeat ? 'REPEAT_SOLVE' : 'SOLVED',
      wrongAttempts,
      tabSwitches: puzzleTabSwitches,
      hintUsed,
      scanCount: Math.max(0, Math.floor(params.notebook?.scanCount ?? 0)),
      pointsEarned,
      pointsLost,
      points: params.pointsDelta,
      totalScore: params.newScore,
      unlockedPuzzles: params.unlocked.join(','),
      solvedPuzzles: params.solved.join(','),
      timestamp: nowIso,
      lastActive: nowIso,
      registeredAt: existing?.registeredAt || nowIso,
    },
    params.repeat ? 'repeat' : 'solve'
  );

  if (hasAppsScriptBackend()) {
    await postWithOutbox({
      action: 'SOLVED',
      eventId,
      tid: cleanTid,
      teamName: params.teamName.trim().slice(0, 60),
      mission: params.mission.trim().slice(0, 40),
      language: fsLang,
      puzzleLevel,
      sessionId: params.sessionId.trim().slice(0, 64),
      puzzleId: Math.max(0, Math.min(10000, Math.floor(params.puzzle.id))),
      wrongAttempts,
      tabSwitches: puzzleTabSwitches,
      hintUsed,
      points: params.pointsDelta,
      totalScore: params.newScore,
      unlockedPuzzles: params.unlocked.map(Number).slice(0, 100),
      solvedPuzzles: params.solved.map(Number).slice(0, 100),
      timestamp: nowIso,
    });
  }
}

export async function recordPuzzleEventToDb(params: {
  tid: string;
  teamName: string;
  mission: string;
  language: LanguageCode;
  sessionId: string;
  action: PuzzleEventAction;
  status: PuzzleEventStatus;
  puzzleId?: number;
  linkid?: string;
  level?: number | string;
  wrongAttempts?: number;
  tabSwitches?: number;
  hintUsed?: boolean;
  scanCount?: number;
  totalScore: number;
  unlocked: number[];
  hintsUsedList?: number[];
  teamTabSwitches?: number;
  epoch: number;
  updateProgressFields?: Partial<{
    hintsUsed: number[];
    tabSwitches: number;
    currentPuzzle: number;
  }>;
}): Promise<void> {
  if (!params.tid) return;
  const cleanTid = params.tid.trim().toUpperCase().slice(0, 32);
  const nowIso = new Date().toISOString();
  const fsLang = toFirestoreLanguage(params.language);
  const eventId = generateEventId();
  const puzzleId = Math.max(0, Math.floor(params.puzzleId ?? 0));
  const wrongAttempts = Math.max(0, Math.floor(params.wrongAttempts ?? 0));
  const tabSwitches = Math.max(0, Math.floor(params.tabSwitches ?? 0));
  const hintUsed = Boolean(params.hintUsed);
  const puzzleLevel = toNumericLevel(params.level, params.mission);

  if (params.updateProgressFields) {
    const existing = readLocalTeamProgress(cleanTid);
    if (existing) {
      writeLocalTeamProgress({
        ...existing,
        hintsUsed: params.updateProgressFields.hintsUsed ?? existing.hintsUsed,
        tabSwitches: params.updateProgressFields.tabSwitches ?? existing.tabSwitches,
        currentPuzzle: params.updateProgressFields.currentPuzzle ?? existing.currentPuzzle,
        updatedAt: nowIso,
      });
    }
  }

  upsertLocalLevelSummaryRow(
    {
      id: eventId,
      action: 'SUMMARY',
      level: toLevelTag(puzzleLevel),
      tid: cleanTid,
      teamName: params.teamName,
      mission: params.mission,
      language: fsLang,
      sessionId: params.sessionId,
      puzzleId,
      linkid: String(params.linkid || ''),
      status: params.status === 'UNSOLVED' ? 'UNSOLVED' : '',
      wrongAttempts,
      tabSwitches,
      hintUsed,
      scanCount: Math.max(0, Math.floor(params.scanCount ?? 0)),
      pointsEarned: 0,
      pointsLost: 0,
      points: 0,
      totalScore: params.totalScore,
      unlockedPuzzles: params.unlocked.join(','),
      timestamp: nowIso,
      lastActive: nowIso,
      registeredAt: nowIso,
    },
    params.action === 'PUZZLE_ABANDONED' ? 'abandon' : 'telemetry'
  );

  if (hasAppsScriptBackend()) {
    await postWithOutbox({
      action: params.action,
      eventId,
      tid: cleanTid,
      teamName: params.teamName.trim().slice(0, 60),
      mission: params.mission.trim().slice(0, 40),
      language: fsLang,
      puzzleLevel,
      sessionId: params.sessionId.trim().slice(0, 64),
      puzzleId,
      wrongAttempts,
      tabSwitches,
      hintUsed,
      totalScore: params.totalScore,
      unlockedPuzzles: params.unlocked.map(Number).slice(0, 100),
      timestamp: nowIso,
    });
  }
}

export async function updateTeamCurrentPuzzleInDb(tid: string, puzzleId: number): Promise<void> {
  if (!tid) return;
  const cleanTid = tid.trim().toUpperCase().slice(0, 32);
  const existing = readLocalTeamProgress(cleanTid);
  if (existing) {
    writeLocalTeamProgress({
      ...existing,
      currentPuzzle: Math.max(0, Math.floor(puzzleId)),
      updatedAt: new Date().toISOString(),
    });
  }
}

// ==========================================
// ADMIN JSON AUTHENTICATION + TELEMETRY
// ==========================================
export async function verifyAdminCredentials(
  adminName: string,
  adminPassword: string
): Promise<boolean> {
  const cleanName = String(adminName || '').trim().toUpperCase();
  const cleanPass = String(adminPassword || '').trim();
  if (!cleanName || !cleanPass) return false;

  const admins = await fetchJsonSafe<AdminCredential[]>('/data/admin.json', []);
  return admins.some(
    (entry) =>
      String(entry.name || '').trim().toUpperCase() === cleanName &&
      String(entry.password || '').trim() === cleanPass
  );
}

function normalizeRemoteAdminRow(raw: Record<string, unknown>, idx: number): NormalizedAdminLogRow {
  const action = String(raw.action || 'SUMMARY').toUpperCase();
  const ts = String(raw.timestamp || raw.registeredAt || raw.lastActive || '');
  const pts = Number(raw.points || 0) || 0;
  return {
    id: String(raw.id || `${action}_${raw.tid || idx}_${raw.puzzleId || 0}_${idx}`),
    action,
    level: action === 'REGISTRATION' ? 'REG' : toLevelTag(raw.level as string | number | undefined),
    tid: String(raw.tid || ''),
    teamName: String(raw.teamName || ''),
    mission: String(raw.mission || ''),
    language: String(raw.language || 'PYTHON'),
    sessionId: String(raw.sessionId || ''),
    puzzleId: Number(raw.puzzleId || 0) || 0,
    linkid: String(raw.linkid || ''),
    status: String(raw.status || (action === 'REGISTRATION' ? 'REGISTERED' : 'UNSOLVED')),
    wrongAttempts: Number(raw.wrongAttempts || 0) || 0,
    tabSwitches: Number(raw.tabSwitches || 0) || 0,
    hintUsed: Boolean(raw.hintUsed),
    scanCount: Number(raw.scanCount || 0) || 0,
    pointsEarned: pts > 0 ? pts : 0,
    pointsLost: pts < 0 ? Math.abs(pts) : 0,
    points: pts,
    totalScore: Number(raw.totalScore || 0) || 0,
    unlockedPuzzles: String(raw.unlockedPuzzles || ''),
    solvedPuzzles: String(raw.solvedPuzzles || ''),
    timestamp: ts,
    lastActive: String(raw.lastActive || ts),
    registeredAt: String(raw.registeredAt || ts),
  };
}

export async function fetchAdminLogs(
  adminKey: string,
  _sinceRow = 2
): Promise<{
  epoch: number;
  logs: NormalizedAdminLogRow[];
  nextSinceRow: number;
  fullSnapshot: boolean;
}> {
  if (hasAppsScriptBackend()) {
    try {
      const res = await callAppsScriptGet(
        'ADMIN_GET_DATA',
        { adminKey: adminKey || undefined },
        20000
      );
      const localEpoch = Math.max(1, Number(localStorage.getItem(STORAGE_KEYS.gameEpoch) || 1));
      const rawRows = Array.isArray(res)
        ? res
        : Array.isArray(res.logs)
          ? res.logs
          : [];
      const remoteEpoch = Array.isArray(res)
        ? localEpoch
        : Math.max(localEpoch, Math.floor(Number(res.epoch || localEpoch)));

      const logs = rawRows
        .filter((r): r is Record<string, unknown> => Boolean(r && typeof r === 'object'))
        .map((r, i) => normalizeRemoteAdminRow(r, i));

      return {
        epoch: remoteEpoch,
        logs,
        nextSinceRow: logs.length + 2,
        fullSnapshot: true,
      };
    } catch (err) {
      if (err instanceof Error && /unauthorized/i.test(err.message)) {
        throw err;
      }
      // fall back cleanly to local telemetry logs on network / offline issues
    }
  }

  const localEpoch = Math.max(1, Number(localStorage.getItem(STORAGE_KEYS.gameEpoch) || 1));
  const allLogs = readLocalTelemetryLogs();
  return {
    epoch: localEpoch,
    logs: allLogs,
    nextSinceRow: allLogs.length + 2,
    fullSnapshot: true,
  };
}

export async function adminResetAllData(adminKey: string): Promise<number> {
  const curEpoch = Math.max(1, Number(localStorage.getItem(STORAGE_KEYS.gameEpoch) || 1));
  let nextEpoch = Math.min(1000000, curEpoch + 1);

  if (hasAppsScriptBackend()) {
    try {
      const res = await callAppsScriptPost({
        action: 'RESET_ALL',
        adminKey: adminKey || undefined,
      });
      const remoteEpoch = Number(res?.epoch || 0);
      if (Number.isFinite(remoteEpoch) && remoteEpoch > 0) {
        nextEpoch = Math.max(nextEpoch, Math.floor(remoteEpoch));
      }
    } catch {
      // keep local epoch bump even if remote offline
    }
  }

  wipeAllLocalGameStorage(nextEpoch);
  return nextEpoch;
}

// ==========================================
// ADMIN CREATOR STUDIO (LOCAL JSON CATALOG OVERRIDES)
// ==========================================
export function sanitizeCatalogId(raw: string, maxLen: number): string {
  return String(raw || '')
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, maxLen);
}

export async function adminUpsertTeams(
  entries: TeamEntry[],
  _adminKey: string
): Promise<number> {
  if (!entries.length) return 0;
  const overrides = readLocalOverrides();
  const delSet = new Set(overrides.teamsDelete.map((d) => d.toUpperCase()));
  let count = 0;
  entries.forEach((e) => {
    const tid = sanitizeCatalogId(String(e.tid || '').toUpperCase(), 32);
    const team = String(e.team || '').trim().slice(0, 60);
    const securityKey = String(e.securityKey || '').trim().slice(0, 64);
    if (!tid || !team || !securityKey) return;
    delSet.delete(tid);
    overrides.teamsUpsert[tid] = {
      tid,
      team,
      securityKey,
      team_members: (e.team_members || []).map(String).filter(Boolean).slice(0, 12),
      isCustom: true,
    };
    count++;
  });
  overrides.teamsDelete = Array.from(delSet);
  overrides.catalogVersion += 1;
  writeLocalOverrides(overrides);
  clearCatalogCache();
  await loadMergedTeams();
  return count;
}

export async function adminDeleteTeamCatalog(tid: string, _adminKey: string): Promise<void> {
  const cleanTid = sanitizeCatalogId(tid.toUpperCase(), 32);
  if (!cleanTid) return;
  const overrides = readLocalOverrides();
  delete overrides.teamsUpsert[cleanTid];
  if (!overrides.teamsDelete.includes(cleanTid)) {
    overrides.teamsDelete.push(cleanTid);
  }
  overrides.catalogVersion += 1;
  writeLocalOverrides(overrides);
  clearCatalogCache();
  await loadMergedTeams();
}

export async function adminUpsertMemes(
  entries: MemeEntry[],
  _adminKey: string
): Promise<number> {
  if (!entries.length) return 0;
  const overrides = readLocalOverrides();
  const delSet = new Set(overrides.memesDelete.map((d) => d.toUpperCase()));
  let count = 0;
  entries.forEach((e) => {
    const memeid = sanitizeCatalogId(String(e.memeid || '').toUpperCase(), 32);
    const ytlink = String(e.ytlink || '').trim().slice(0, 512);
    if (!memeid || ytlink.length < 5) return;
    const start = Math.max(0, Number(e.starttime || 0));
    const end = Math.max(0, Number(e.endtime || 0));
    delSet.delete(memeid);
    overrides.memesUpsert[memeid] = {
      memeid,
      ytlink,
      starttime: start,
      endtime: end > 0 && end < start ? start : end,
      isCustom: true,
    };
    count++;
  });
  overrides.memesDelete = Array.from(delSet);
  overrides.catalogVersion += 1;
  writeLocalOverrides(overrides);
  clearCatalogCache();
  return count;
}

export async function adminDeleteMemeCatalog(memeid: string, _adminKey: string): Promise<void> {
  const cleanId = sanitizeCatalogId(memeid.toUpperCase(), 32);
  if (!cleanId) return;
  const overrides = readLocalOverrides();
  delete overrides.memesUpsert[cleanId];
  if (!overrides.memesDelete.includes(cleanId)) {
    overrides.memesDelete.push(cleanId);
  }
  overrides.catalogVersion += 1;
  writeLocalOverrides(overrides);
  clearCatalogCache();
}

export async function adminUpsertPuzzles(
  entries: Puzzle[],
  _adminKey: string
): Promise<number> {
  if (!entries.length) return 0;
  const overrides = readLocalOverrides();
  const delSet = new Set(overrides.puzzlesDelete);
  let count = 0;
  entries.forEach((e) => {
    const norm = normalizeLoadedPuzzle(e, true);
    if (!norm.id || !norm.linkid || !norm.answer) return;
    delSet.delete(norm.id);
    overrides.puzzlesUpsert[String(norm.id)] = norm;
    count++;
  });
  overrides.puzzlesDelete = Array.from(delSet);
  overrides.catalogVersion += 1;
  writeLocalOverrides(overrides);
  clearCatalogCache();
  return count;
}

export async function adminDeletePuzzleCatalog(id: number, _adminKey: string): Promise<void> {
  const pid = Math.floor(Number(id));
  if (!pid || Number.isNaN(pid)) return;
  const overrides = readLocalOverrides();
  delete overrides.puzzlesUpsert[String(pid)];
  if (!overrides.puzzlesDelete.includes(pid)) {
    overrides.puzzlesDelete.push(pid);
  }
  overrides.catalogVersion += 1;
  writeLocalOverrides(overrides);
  clearCatalogCache();
}
