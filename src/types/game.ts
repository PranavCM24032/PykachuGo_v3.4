export type LanguageCode = 'PYTHON' | 'CPP';
export type FirestoreLanguage = 'PYTHON' | 'C++';
export type StepId = 0 | 1 | 2 | 'startcode' | 3 | 4;

export interface Puzzle {
  id: number;
  linkid: string;
  badgeId?: number;
  questionPython: string;
  questionCpp: string;
  answer: string;
  nextPuzzleId: number[];
  startCode?: string;
  requiresStartCode?: boolean;
  locationClue: string;
  level: number;
  points: number;
  hint?: string | boolean;
  hasHint?: boolean;
  hintPenalty?: number;
  pokemonId: number;
  pokemonName: string;
  hintUsed?: boolean;
  isCustom?: boolean;
}

export interface TeamEntry {
  team: string;
  securityKey: string;
  tid: string;
  team_members: string[];
  isCustom?: boolean;
}

export interface AdminCredential {
  name: string;
  password: string;
}

export interface MemeEntry {
  memeid: string;
  ytlink: string;
  starttime: number;
  endtime: number;
  isCustom?: boolean;
}

export interface SelectOption {
  value: string;
  label: string;
  icon?: string;
}

export interface MissionGroup {
  label: string;
  level: string;
  labelClass?: string;
  missions: SelectOption[];
}

export interface GameConfig {
  languages: SelectOption[];
  missionTypes: SelectOption[];
  missionGroups: MissionGroup[];
}

export interface PuzzleNotebookEntry {
  puzzleId: number;
  linkid: string;
  level: number | string;
  startedAt: number;
  unlockedAt: number | null;
  scanCount: number;
  wrongAttempts: number;
  hintsUsed: number;
  tabSwitches: number;
  solvedAt: number | null;
  dirty: boolean;
  lastActivityAt: number;
  pendingEventId?: string;
}

export interface ToastMessage {
  id: string;
  message: string;
  type: 'info' | 'success' | 'error';
}

export interface ConfirmDialogOptions {
  title?: string;
  message?: string;
  icon?: string;
  iconClass?: string;
  titleClass?: string;
  accentClass?: string;
  primaryClass?: string;
  primaryIcon?: string;
  okText?: string;
  cancelText?: string;
}

export type PuzzleEventAction =
  | 'REGISTRATION'
  | 'SUMMARY'
  | 'SOLVED'
  | 'PUZZLE_ABANDONED'
  | 'WRONG_ATTEMPT'
  | 'HINT_USED'
  | 'PENALTY_TRIGGERED'
  | 'QR_SCANNED'
  | 'QR_BLOCKED'
  | 'PUZZLE_UNLOCKED'
  | 'UNLOCK_FAILED';

export type PuzzleEventStatus =
  | 'REGISTERED'
  | 'ACTIVE'
  | 'SOLVED'
  | 'REPEAT_SOLVE'
  | 'UNSOLVED'
  | 'ABANDONED'
  | 'BLOCKED';

export interface TeamProgressDoc {
  tid: string;
  teamName: string;
  mission: string;
  language: FirestoreLanguage;
  sessionId: string;
  score: number;
  solved: number[];
  unlocked: number[];
  hintsUsed: number[];
  currentPuzzle: number;
  tabSwitches: number;
  epoch: number;
  registeredAt?: string;
  updatedAt?: string;
}

export interface PuzzleLogDoc {
  id?: string;
  tid: string;
  teamName: string;
  mission: string;
  language: FirestoreLanguage;
  level: 'REG' | 'L1' | 'L2' | 'L3';
  sessionId: string;
  action: PuzzleEventAction;
  puzzleId: number;
  linkid: string;
  status: PuzzleEventStatus;
  wrongAttempts: number;
  tabSwitches: number;
  hintUsed: boolean;
  scanCount: number;
  pointsEarned: number;
  pointsLost: number;
  points: number;
  totalScore: number;
  unlockedPuzzles: string;
  epoch: number;
  clientTimestamp: string;
  createdAt?: string;
}

export const STORAGE_KEYS = {
  hintState: 'pykachuHintState',
  gameState: 'pykachuGameState',
  teamInfo: 'pykachuTeam',
  scoreState: 'pykachuScoreState',
  gameEpoch: 'pykachuGameEpoch',
  puzzleNotebook: 'pykachuPuzzleNotebook',
  catalogCache: 'pykachuCatalogCache_v1',
  localCatalogOverrides: 'pykachuLocalCatalogOverrides_v1',
  localLogs: 'pykachuLocalTelemetryLogs_v1',
  localTeamProgress: 'pykachuLocalTeamProgress_v1',
  pendingSyncQueue: 'pykachuPendingSyncQueue_v1',
  adminSessionKey: 'pykachuAdminSessionKey',
} as const;

export const HINT_SETTINGS = {
  defaultPenalty: 60,
  hintRequestTimeout: 30,
  tabSwitchResetsPenalty: true,
} as const;
