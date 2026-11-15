import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  getMuted,
  initAudio,
  playSound,
  prewarmCelebrationAudio,
  toggleBgm,
  toggleMute,
} from './services/audio';
import {
  authenticateTeamFromDb,
  clearGameStateLocal,
  computeLocalUnlocked,
  deletePuzzleNotebookEntry,
  fetchGameMeta,
  fetchServerGameEpoch,
  generateSessionId,
  getHintUsedLocal,
  getNextPuzzles,
  getPokemonArtworkUrl,
  getPuzzleNotebook,
  getPuzzleQuestion,
  getRememberedTeamInfo,
  getSavedGameState,
  getTeamScoreStateLocal,
  isPuzzleAllowed,
  isStartingPuzzle,
  loadPlayerCatalog,
  notepadBumpLocal,
  notepadStartLocal,
  puzzleGateMessage,
  puzzleHasHint,
  readCachedPlayerCatalog,
  recordPuzzleEventToDb,
  recordPuzzleSolveToDb,
  resolveUniversalLink,
  saveGameStateLocal,
  saveHintUsedLocal,
  saveRememberedTeamInfo,
  saveTeamScoreStateLocal,
  standardizeString,
  startOutboxSyncLoop,
  syncTeamRegistrationToDb,
  updateTeamCurrentPuzzleInDb,
  wipeAllLocalGameStorage,
} from './services/gameBackend';
import {
  HINT_SETTINGS,
  STORAGE_KEYS,
  type GameConfig,
  type LanguageCode,
  type MemeEntry,
  type Puzzle,
  type StepId,
  type ToastMessage,
} from './types/game';
import { LoaderSplash } from './components/LoaderSplash';
import { ToastContainer } from './components/ToastContainer';
import { SecurityBarrier } from './components/SecurityBarrier';
import { PenaltyOverlay } from './components/PenaltyOverlay';
import { SignOutOverlay } from './components/SignOutOverlay';
import { CameraGuideOverlay } from './components/CameraGuideOverlay';
import { MemePlayerOverlay } from './components/MemePlayerOverlay';
import { Step0Rules } from './components/Step0Rules';
import { Step1Login } from './components/Step1Login';
import { Step2Scanner } from './components/Step2Scanner';
import { StartCodeStep } from './components/StartCodeStep';
import { Step3Puzzle } from './components/Step3Puzzle';
import { Step4Success } from './components/Step4Success';
import { AdminDashboard } from './components/AdminDashboard';
import { PortraitLockOverlay } from './components/PortraitLockOverlay';

function checkIsAdminRoute(): boolean {
  const path = window.location.pathname.toLowerCase().replace(/\/+$/, '');
  const hash = window.location.hash.toLowerCase();
  const params = new URLSearchParams(window.location.search);
  return path.endsWith('/admin') || hash === '#admin' || params.get('admin') === '1';
}

export default function App() {
  const [isAdminRoute, setIsAdminRoute] = useState<boolean>(checkIsAdminRoute);

  useEffect(() => {
    const syncRoute = () => setIsAdminRoute(checkIsAdminRoute());
    window.addEventListener('popstate', syncRoute);
    window.addEventListener('hashchange', syncRoute);
    return () => {
      window.removeEventListener('popstate', syncRoute);
      window.removeEventListener('hashchange', syncRoute);
    };
  }, []);

  useEffect(() => {
    if (window.location.protocol !== 'https:') return;
    const currentUrl = window.location.origin + window.location.pathname;
    const canonical = document.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    if (canonical) canonical.href = currentUrl;
    const ogUrl = document.querySelector<HTMLMetaElement>('meta[property="og:url"]');
    if (ogUrl) ogUrl.content = currentUrl;
  }, [isAdminRoute]);

  if (isAdminRoute) {
    return <AdminDashboard />;
  }

  return <PokedexGameApp />;
}

const PokedexGameApp: React.FC = () => {
  // Data catalog
  const [puzzles, setPuzzles] = useState<Puzzle[]>([]);
  const [memes, setMemes] = useState<MemeEntry[]>([]);
  const [config, setConfig] = useState<GameConfig | null>(null);
  const catalogVersionRef = useRef<number>(1);
  const [booted, setBooted] = useState(false);

  // UI & Flow State
  const [currentStep, setCurrentStep] = useState<StepId>(0);
  const [isCrtOn, setIsCrtOn] = useState(true);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [signOutVisible, setSignOutVisible] = useState(false);
  const [cameraGuideState, setCameraGuideState] = useState<{
    visible: boolean;
    reason: 'inapp' | 'permission';
  }>({ visible: false, reason: 'permission' });
  const [activeMeme, setActiveMeme] = useState<MemeEntry | null>(null);

  // Team & Session State
  const [currentTeam, setCurrentTeam] = useState('');
  const [currentTeamTid, setCurrentTeamTid] = useState('');
  const [currentMissionLevel, setCurrentMissionLevel] = useState('');
  const [currentLanguage, setCurrentLanguage] = useState<LanguageCode>('PYTHON');
  const [sessionId, setSessionId] = useState<string>(() => generateSessionId());
  const [epoch, setEpoch] = useState<number>(() =>
    Math.max(1, Number(localStorage.getItem(STORAGE_KEYS.gameEpoch) || 1))
  );

  // Progress State
  const [score, setScore] = useState(0);
  const [solvedIds, setSolvedIds] = useState<number[]>([]);
  const [unlockedIds, setUnlockedIds] = useState<number[]>([]);
  const [hintsUsedIds, setHintsUsedIds] = useState<number[]>([]);
  const [tabSwitchCount, setTabSwitchCount] = useState(0);

  // Active Puzzle / Step 1 / Startcode / Step 3 / Step 4
  const [currentPuzzle, setCurrentPuzzle] = useState<Puzzle | null>(null);
  const [urlLockedPuzzle, setUrlLockedPuzzle] = useState<Puzzle | null>(null);
  const pendingDeepLinkRef = useRef<Puzzle | null>(null);

  // Form fields (Step 1)
  const [formTeamName, setFormTeamName] = useState('');
  const [formSecurityKey, setFormSecurityKey] = useState('');
  const [formLanguage, setFormLanguage] = useState<LanguageCode>('PYTHON');
  const [formMissionLevel, setFormMissionLevel] = useState('');
  const [regFeedback, setRegFeedback] = useState<{
    message: string;
    type: 'error' | 'success' | 'info';
  } | null>(null);
  const [regShakeField, setRegShakeField] = useState<'teamName' | 'teamSecurityKey' | null>(null);
  const [isRegSubmitting, setIsRegSubmitting] = useState(false);

  // Startcode form
  const [unlockCode, setUnlockCode] = useState('');
  const [unlockFeedback, setUnlockFeedback] = useState<{
    message: string;
    type: 'error' | 'success' | 'info';
  } | null>(null);
  const [unlockShake, setUnlockShake] = useState(false);

  // Step 3 Puzzle Terminal
  const [puzzleStartMs, setPuzzleStartMs] = useState<number>(Date.now());
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [answerValue, setAnswerValue] = useState('');
  const [answerShake, setAnswerShake] = useState(false);
  const [terminalLocked, setTerminalLocked] = useState(false);
  const [ensureChecked, setEnsureChecked] = useState(false);
  const terminalLockedRef = useRef(false);
  const pendingHintResumeRef = useRef(false);
  const answerLockedRef = useRef(false);
  const answerInputRef = useRef<HTMLInputElement | null>(null);

  const setTerminalLockedSafe = useCallback((locked: boolean) => {
    terminalLockedRef.current = locked;
    setTerminalLocked(locked);
  }, []);

  // Step 4 Reveal
  const [revealKey, setRevealKey] = useState(0);
  const [screenGlow, setScreenGlow] = useState(false);
  const [screenGlitch, setScreenGlitch] = useState(false);

  // Penalty (Officer Jenny)
  const [penaltyVisible, setPenaltyVisible] = useState(false);
  const [penaltySeconds, setPenaltySeconds] = useState(15);
  const [penaltyRingIteration, setPenaltyRingIteration] = useState(0);
  const penaltyVisibleRef = useRef(false);
  const penaltyIntervalRef = useRef<number | null>(null);
  const penaltyOnFinishRef = useRef<(() => void) | null>(null);

  // Hint System (Brock)
  const [hintRequestOpen, setHintRequestOpen] = useState(false);
  const [hintPenaltyOpen, setHintPenaltyOpen] = useState(false);
  const [hintPenaltySeconds, setHintPenaltySeconds] = useState<number>(HINT_SETTINGS.defaultPenalty);
  const [hintPenaltyRingIteration, setHintPenaltyRingIteration] = useState(0);
  const [hintFocusLost, setHintFocusLost] = useState(false);
  const [hintDisplayOpen, setHintDisplayOpen] = useState(false);

  const hintRequestTimeoutRef = useRef<number | null>(null);
  const hintPenaltyIntervalRef = useRef<number | null>(null);
  const hintPenaltyActiveRef = useRef(false);
  const hintMalpracticeRunningRef = useRef(false);
  const hintSecondsRef = useRef<number>(HINT_SETTINGS.defaultPenalty);

  // Hardware & DOM Refs
  const screenRef = useRef<HTMLDivElement | null>(null);
  const celebrationCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const powerTimerRef = useRef<number | null>(null);
  const powerLongPressedRef = useRef(false);
  const aux1Ref = useRef<HTMLDivElement | null>(null);
  const aux2Ref = useRef<HTMLDivElement | null>(null);

  const isLoggedIn = Boolean(currentTeam && currentTeam.trim() !== '');
  const teamKey = currentTeamTid || currentTeam;

  const solvedSet = useMemo(() => new Set<number>(solvedIds.map(Number)), [solvedIds]);
  const unlockedSet = useMemo(() => new Set<number>(unlockedIds.map(Number)), [unlockedIds]);
  const hintsUsedSet = useMemo(() => new Set<number>(hintsUsedIds.map(Number)), [hintsUsedIds]);

  const puzzleById = useMemo(() => {
    const m = new Map<number, Puzzle>();
    puzzles.forEach((p) => m.set(Number(p.id), p));
    return m;
  }, [puzzles]);

  const puzzleByLinkId = useMemo(() => {
    const m = new Map<string, Puzzle>();
    puzzles.forEach((p) => m.set(standardizeString(p.linkid), p));
    return m;
  }, [puzzles]);

  const memeById = useMemo(() => {
    const m = new Map<string, MemeEntry>();
    memes.forEach((mm) => m.set(standardizeString(mm.memeid), mm));
    return m;
  }, [memes]);

  const showToast = useCallback(
    (message: string, type: 'info' | 'success' | 'error' = 'info') => {
      const id = `toast_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      setToasts((prev) => [...prev, { id, message, type }]);
      window.setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, 3000);
    },
    []
  );

  // Background outbox retry loop for offline / transient Google Sheets sync
  useEffect(() => {
    if (!booted) return;
    return startOutboxSyncLoop();
  }, [booted]);

  // Persist minimal gameState on change
  useEffect(() => {
    if (!booted) return;
    saveGameStateLocal({
      currentStep,
      currentTeam,
      currentTeamTid,
      currentMissionLevel,
      currentLanguage,
      sessionId,
      tabSwitchCount,
      currentPuzzleId: currentPuzzle ? currentPuzzle.id : null,
      terminalLocked: currentStep === 3 ? terminalLocked : false,
    });
  }, [
    booted,
    currentStep,
    currentTeam,
    currentTeamTid,
    currentMissionLevel,
    currentLanguage,
    sessionId,
    tabSwitchCount,
    currentPuzzle,
    terminalLocked,
  ]);

  // Boot app: instant SWR hydrate from version-matched cache, then live Google Sheets sync
  useEffect(() => {
    let cancelled = false;

    const applyCatalogSnapshot = (
      data: {
        puzzles: Puzzle[];
        memes: MemeEntry[];
        config: GameConfig;
        catalogVersion: number;
        epoch: number;
      },
      isFirstHydration: boolean
    ) => {
      setPuzzles(data.puzzles);
      setMemes(data.memes);
      setConfig(data.config);
      catalogVersionRef.current = data.catalogVersion;

      const localEpoch = Number(localStorage.getItem(STORAGE_KEYS.gameEpoch) || 1);
      if (data.epoch > localEpoch) {
        wipeAllLocalGameStorage(data.epoch);
        setEpoch(data.epoch);
      }

      if (isFirstHydration) {
        initAudio();
        window.setTimeout(() => prewarmCelebrationAudio(), 1200);

        const { puzzle, meme } = resolveUniversalLink(data.puzzles, data.memes);
        if (puzzle) {
          pendingDeepLinkRef.current = puzzle;
          if (isStartingPuzzle(puzzle)) {
            setUrlLockedPuzzle(puzzle);
          }
        }
        if (meme) {
          window.setTimeout(() => {
            if (!cancelled) setActiveMeme(meme);
          }, 600);
        }

        const defaultLang = (data.config.languages?.[0]?.value as LanguageCode) || 'PYTHON';
        const defaultMission = data.config.missionGroups?.[0]?.missions?.[0]?.value || 'L1_GRASS';
        const remembered = getRememberedTeamInfo();
        if (remembered) {
          setFormTeamName(remembered.teamName || '');
          setFormLanguage(remembered.language || defaultLang);
          const legacyMappings: Record<string, string> = {
            L2_CHARIZARD: 'L2_GHOST',
            L2_GRENINJA: 'L2_FAIRY',
          };
          const mappedMission = legacyMappings[remembered.mission] || remembered.mission;
          setFormMissionLevel(mappedMission || defaultMission);
        } else {
          setFormLanguage(defaultLang);
          setFormMissionLevel(defaultMission);
        }
        setBooted(true);
      }
    };

    (async () => {
      const cached = readCachedPlayerCatalog();
      if (cached && !cancelled) {
        applyCatalogSnapshot(cached, true);
      }

      try {
        const liveData = await loadPlayerCatalog();
        if (cancelled) return;
        const staleOrMissing =
          !cached ||
          liveData.catalogVersion !== cached.catalogVersion ||
          liveData.epoch !== cached.epoch ||
          liveData.puzzles.length !== cached.puzzles.length;

        if (!cached) {
          applyCatalogSnapshot(liveData, true);
        } else if (staleOrMissing) {
          applyCatalogSnapshot(liveData, false);
        }
      } catch (err) {
        console.error('[Startup] Failed to sync DB catalog:', err);
        if (!cached && !cancelled) {
          showToast('Game data could not be loaded from DB. Refresh or contact admin.', 'error');
          setBooted(true);
        }
      }
    })();

    const onVisChange = () => {
      document.documentElement.classList.toggle('page-hidden', document.hidden);
    };
    document.addEventListener('visibilitychange', onVisChange);

    // Attempt native portrait orientation lock where supported (e.g. mobile PWA)
    try {
      const orientation = screen.orientation as ScreenOrientation & {
        lock?: (o: string) => Promise<void>;
      };
      if (orientation && typeof orientation.lock === 'function') {
        orientation.lock('portrait-primary').catch(() => {});
      }
    } catch {
      // ignore unsupported orientation lock
    }

    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisChange);
    };
  }, [showToast]);

  // Puzzle timer on Step 3
  useEffect(() => {
    if (currentStep !== 3 || !currentPuzzle) {
      setElapsedSeconds(0);
      return;
    }
    const tick = () => {
      setElapsedSeconds(Math.max(0, Math.floor((Date.now() - puzzleStartMs) / 1000)));
    };
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [currentStep, currentPuzzle, puzzleStartMs]);

  // Cleanup helpers for Hint + Penalty
  const clearPenalty = useCallback(() => {
    if (penaltyIntervalRef.current !== null) {
      window.clearInterval(penaltyIntervalRef.current);
      penaltyIntervalRef.current = null;
    }
    penaltyVisibleRef.current = false;
    setPenaltyVisible(false);
    setPenaltySeconds(15);
    penaltyOnFinishRef.current = null;
  }, []);

  const cleanupHintSystem = useCallback(() => {
    if (hintPenaltyIntervalRef.current !== null) {
      window.clearInterval(hintPenaltyIntervalRef.current);
      hintPenaltyIntervalRef.current = null;
    }
    if (hintRequestTimeoutRef.current !== null) {
      window.clearTimeout(hintRequestTimeoutRef.current);
      hintRequestTimeoutRef.current = null;
    }
    hintPenaltyActiveRef.current = false;
    hintMalpracticeRunningRef.current = false;
    pendingHintResumeRef.current = false;
    setHintRequestOpen(false);
    setHintPenaltyOpen(false);
    setHintDisplayOpen(false);
    setHintFocusLost(false);
  }, []);

  // Stop hint/penalty/lock timers whenever leaving Step 3
  useEffect(() => {
    if (currentStep !== 3) {
      cleanupHintSystem();
      clearPenalty();
      setTerminalLockedSafe(false);
      setEnsureChecked(false);
    }
  }, [currentStep, cleanupHintSystem, clearPenalty, setTerminalLockedSafe]);

  // Blocking 15s Officer Jenny Penalty
  const triggerJennyPenalty = useCallback(
    (onFinish?: () => void) => {
      if (penaltyVisibleRef.current) return;
      penaltyVisibleRef.current = true;
      penaltyOnFinishRef.current = onFinish || null;

      setPenaltySeconds(15);
      setPenaltyRingIteration((n) => n + 1);
      setPenaltyVisible(true);
      playSound('penalty');

      const nextTabs = tabSwitchCount + 1;
      setTabSwitchCount(nextTabs);

      if (teamKey && currentPuzzle) {
        const nb = notepadBumpLocal(teamKey, 'tabswitch', currentPuzzle);
        void recordPuzzleEventToDb({
          tid: currentTeamTid,
          teamName: currentTeam,
          mission: currentMissionLevel,
          language: currentLanguage,
          sessionId,
          action: 'PENALTY_TRIGGERED',
          status: 'ACTIVE',
          puzzleId: currentPuzzle.id,
          linkid: currentPuzzle.linkid,
          level: currentPuzzle.level,
          wrongAttempts: nb?.wrongAttempts ?? 0,
          tabSwitches: nb?.tabSwitches ?? nextTabs,
          hintUsed: hintsUsedSet.has(currentPuzzle.id),
          scanCount: nb?.scanCount ?? 0,
          totalScore: score,
          unlocked: unlockedIds,
          epoch,
          updateProgressFields: { tabSwitches: nextTabs },
        });
      }

      let remaining = 15;
      if (penaltyIntervalRef.current !== null) {
        window.clearInterval(penaltyIntervalRef.current);
      }
      penaltyIntervalRef.current = window.setInterval(() => {
        remaining -= 1;
        setPenaltySeconds(remaining);
        if (remaining <= 0) {
          if (penaltyIntervalRef.current !== null) {
            window.clearInterval(penaltyIntervalRef.current);
            penaltyIntervalRef.current = null;
          }
          penaltyVisibleRef.current = false;
          setPenaltyVisible(false);
          playSound('penaltyComplete');
          const cb = penaltyOnFinishRef.current;
          penaltyOnFinishRef.current = null;
          if (cb) cb();
        }
      }, 1000);
    },
    [
      tabSwitchCount,
      teamKey,
      currentPuzzle,
      currentTeamTid,
      currentTeam,
      currentMissionLevel,
      currentLanguage,
      sessionId,
      hintsUsedSet,
      score,
      unlockedIds,
      epoch,
    ]
  );

  // Complete Brock Hint Countdown -> Reveal Hint
  const completeHintCountdown = useCallback(() => {
    if (hintPenaltyIntervalRef.current !== null) {
      window.clearInterval(hintPenaltyIntervalRef.current);
      hintPenaltyIntervalRef.current = null;
    }
    hintPenaltyActiveRef.current = false;
    setHintPenaltyOpen(false);
    setHintDisplayOpen(true);
    playSound('hintReveal');
    showToast('Hint unlocked!', 'success');

    if (currentPuzzle) {
      const pid = Number(currentPuzzle.id);
      const nextHints = Array.from(new Set([...hintsUsedIds, pid]));
      const firstUse = !hintsUsedIds.includes(pid);
      setHintsUsedIds(nextHints);
      if (currentTeam) saveHintUsedLocal(currentTeam, pid);
      if (teamKey) {
        saveTeamScoreStateLocal(teamKey, {
          score,
          solved: solvedIds,
          unlocked: unlockedIds,
          hintsUsed: nextHints,
        });
        if (firstUse) {
          notepadBumpLocal(teamKey, 'hint', currentPuzzle);
        }
        const nb = getPuzzleNotebook(teamKey)[String(pid)];
        void recordPuzzleEventToDb({
          tid: currentTeamTid,
          teamName: currentTeam,
          mission: currentMissionLevel,
          language: currentLanguage,
          sessionId,
          action: 'HINT_USED',
          status: 'ACTIVE',
          puzzleId: pid,
          linkid: currentPuzzle.linkid,
          level: currentPuzzle.level,
          wrongAttempts: nb?.wrongAttempts ?? 0,
          tabSwitches: nb?.tabSwitches ?? 0,
          hintUsed: true,
          scanCount: nb?.scanCount ?? 0,
          totalScore: score,
          unlocked: unlockedIds,
          epoch,
          updateProgressFields: { hintsUsed: nextHints },
        });
      }
    }
  }, [
    currentPuzzle,
    hintsUsedIds,
    currentTeam,
    teamKey,
    score,
    solvedIds,
    unlockedIds,
    currentTeamTid,
    currentMissionLevel,
    currentLanguage,
    sessionId,
    epoch,
    showToast,
  ]);

  const startBrockCountdown = useCallback(
    (isReset = false) => {
      if (!currentPuzzle) return;
      const total =
        currentPuzzle.hintPenalty && currentPuzzle.hintPenalty > 0
          ? currentPuzzle.hintPenalty
          : HINT_SETTINGS.defaultPenalty;

      hintPenaltyActiveRef.current = true;
      hintSecondsRef.current = total;
      setHintPenaltySeconds(total);
      setHintPenaltyRingIteration((n) => n + 1);
      setHintPenaltyOpen(true);
      setHintFocusLost(isReset);

      if (hintPenaltyIntervalRef.current !== null) {
        window.clearInterval(hintPenaltyIntervalRef.current);
      }
      hintPenaltyIntervalRef.current = window.setInterval(() => {
        if (!hintPenaltyActiveRef.current) return;
        hintSecondsRef.current -= 1;
        setHintPenaltySeconds(hintSecondsRef.current);
        if (hintSecondsRef.current <= 0) {
          completeHintCountdown();
        }
      }, 1000);

      playSound(isReset ? 'penaltyReset' : 'hintStart');
    },
    [currentPuzzle, completeHintCountdown]
  );

  // Tab monitoring on Step 3 (auto-locks ONLY the Terminal & coordinates Jenny + Brock)
  useEffect(() => {
    if (currentStep !== 3 || !isLoggedIn) return;

    const handleViolation = () => {
      const alreadyLocked = terminalLockedRef.current;
      setTerminalLockedSafe(true);
      setEnsureChecked(false);
      if (alreadyLocked || penaltyVisibleRef.current) return;

      if (hintPenaltyActiveRef.current) {
        if (hintMalpracticeRunningRef.current) return;
        hintMalpracticeRunningRef.current = true;
        pendingHintResumeRef.current = true;
        if (hintPenaltyIntervalRef.current !== null) {
          window.clearInterval(hintPenaltyIntervalRef.current);
          hintPenaltyIntervalRef.current = null;
        }
        triggerJennyPenalty(() => {
          hintMalpracticeRunningRef.current = false;
        });
      } else {
        triggerJennyPenalty();
      }
    };

    const onVisibilityChange = () => {
      if (document.hidden) handleViolation();
    };

    const onBlur = () => {
      window.setTimeout(() => {
        if (document.hidden || !document.hasFocus()) {
          handleViolation();
        }
      }, 100);
    };

    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('blur', onBlur);
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('blur', onBlur);
    };
  }, [currentStep, isLoggedIn, setTerminalLockedSafe, triggerJennyPenalty]);

  const handleUnlockTerminal = useCallback(() => {
    if (!ensureChecked) return;
    setTerminalLockedSafe(false);
    setEnsureChecked(false);
    showToast('Terminal unlocked — Stay focused!', 'success');
    if (pendingHintResumeRef.current && hintPenaltyActiveRef.current) {
      pendingHintResumeRef.current = false;
      startBrockCountdown(true);
    } else {
      window.setTimeout(() => {
        answerInputRef.current?.focus();
      }, 120);
    }
  }, [ensureChecked, setTerminalLockedSafe, showToast, startBrockCountdown]);

  // 20s Idle Notebook Watchdog (flushes abandoned unsolved notebooks after 60s)
  useEffect(() => {
    if (!isLoggedIn || !teamKey) return;
    const id = window.setInterval(() => {
      const nb = getPuzzleNotebook(teamKey);
      const now = Date.now();
      Object.values(nb).forEach((entry) => {
        if (!entry.dirty || entry.solvedAt) return;
        if (currentStep === 3 && currentPuzzle && Number(entry.puzzleId) === Number(currentPuzzle.id)) {
          return;
        }
        if (now - entry.lastActivityAt >= 60000) {
          void recordPuzzleEventToDb({
            tid: currentTeamTid,
            teamName: currentTeam,
            mission: currentMissionLevel,
            language: currentLanguage,
            sessionId,
            action: 'PUZZLE_ABANDONED',
            status: 'ABANDONED',
            puzzleId: entry.puzzleId,
            linkid: entry.linkid,
            level: entry.level,
            wrongAttempts: entry.wrongAttempts,
            tabSwitches: entry.tabSwitches,
            hintUsed: entry.hintsUsed > 0,
            scanCount: entry.scanCount,
            totalScore: score,
            unlocked: unlockedIds,
            epoch,
          });
          deletePuzzleNotebookEntry(teamKey, entry.puzzleId);
        }
      });
    }, 20000);
    return () => window.clearInterval(id);
  }, [
    isLoggedIn,
    teamKey,
    currentStep,
    currentPuzzle,
    currentTeamTid,
    currentTeam,
    currentMissionLevel,
    currentLanguage,
    sessionId,
    score,
    unlockedIds,
    epoch,
  ]);

  // Warn before unload if serving a penalty
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (penaltyVisible || hintPenaltyOpen) {
        e.preventDefault();
        e.returnValue = 'You are currently serving a penalty. Are you sure you want to leave?';
      }
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [penaltyVisible, hintPenaltyOpen]);

  // Activate a puzzle and preload its artwork + next artwork
  const activatePuzzle = useCallback(
    (puzzle: Puzzle, keepLocked = false) => {
      setCurrentPuzzle(puzzle);
      setPuzzleStartMs(Date.now());
      setElapsedSeconds(0);
      setAnswerValue('');
      setTerminalLockedSafe(keepLocked);
      setEnsureChecked(false);
      answerLockedRef.current = false;

      // Preload PokéAPI artwork
      const img1 = new Image();
      img1.src = getPokemonArtworkUrl(puzzle.pokemonId);
      getNextPuzzles(puzzles, puzzle).forEach((np) => {
        const img = new Image();
        img.src = getPokemonArtworkUrl(np.pokemonId);
      });

      const activeKey = currentTeamTid || currentTeam;
      if (activeKey) {
        notepadStartLocal(activeKey, puzzle);
        void updateTeamCurrentPuzzleInDb(activeKey, puzzle.id);
      }

      if (!keepLocked) {
        window.setTimeout(() => {
          answerInputRef.current?.focus();
        }, 120);
      }
    },
    [puzzles, currentTeamTid, currentTeam, setTerminalLockedSafe]
  );

  // Step 1: Login / Registration Handler (Google Sheets + Apps Script Sync)
  const performRegistrationLogin = async () => {
    const teamInput = formTeamName.trim();
    const secKey = formSecurityKey.trim();

    if (!formMissionLevel || !formLanguage) {
      setRegFeedback({
        message: 'Game options are unavailable. Refresh and try again.',
        type: 'error',
      });
      return;
    }

    if (!teamInput || !secKey) {
      setRegFeedback({
        message: 'Team name and security key are required!',
        type: 'error',
      });
      return;
    }

    setIsRegSubmitting(true);
    setRegFeedback(null);

    try {
      const [foundTeam, latestMeta] = await Promise.all([
        authenticateTeamFromDb(teamInput),
        fetchGameMeta(),
      ]);

      if (!foundTeam) {
        setRegFeedback({
          message: 'Trainer not found. Check the team name and try again.',
          type: 'error',
        });
        setRegShakeField('teamName');
        window.setTimeout(() => setRegShakeField(null), 500);
        playSound('error');
        return;
      }

      if (standardizeString(secKey) !== standardizeString(foundTeam.securityKey)) {
        setRegFeedback({
          message: 'Invalid team name or security key!',
          type: 'error',
        });
        setRegShakeField('teamSecurityKey');
        window.setTimeout(() => setRegShakeField(null), 500);
        playSound('error');
        return;
      }

      let activePuzzles = puzzles;
      if (latestMeta.catalogVersion > catalogVersionRef.current) {
        const refreshed = await loadPlayerCatalog(true);
        activePuzzles = refreshed.puzzles;
        setPuzzles(refreshed.puzzles);
        setMemes(refreshed.memes);
        setConfig(refreshed.config);
        catalogVersionRef.current = refreshed.catalogVersion;
      }

      const resolvedTeamName = foundTeam.team;
      const resolvedTid = foundTeam.tid || resolvedTeamName;
      const prevRemembered = getRememberedTeamInfo();
      const prevKey = prevRemembered ? prevRemembered.tid || prevRemembered.teamName : '';
      const isDifferentTeam = !prevKey || prevKey !== resolvedTid;

      let nextSessionId = sessionId;
      if (isDifferentTeam) {
        nextSessionId = generateSessionId();
        setSessionId(nextSessionId);
        clearGameStateLocal();
      }

      const { epoch: serverEpoch, teamProgress } = await syncTeamRegistrationToDb({
        tid: resolvedTid,
        teamName: resolvedTeamName,
        mission: formMissionLevel,
        language: formLanguage,
        sessionId: nextSessionId,
        puzzles: activePuzzles,
        serverEpochOverride: latestMeta.epoch,
      });

      setEpoch(serverEpoch);
      setCurrentTeam(resolvedTeamName);
      setCurrentTeamTid(resolvedTid);
      setCurrentMissionLevel(formMissionLevel);
      setCurrentLanguage(formLanguage);
      setScore(teamProgress.score);
      setSolvedIds(teamProgress.solved);
      setUnlockedIds(teamProgress.unlocked);
      setHintsUsedIds(teamProgress.hintsUsed);
      setTabSwitchCount(teamProgress.tabSwitches);

      saveRememberedTeamInfo({
        teamName: resolvedTeamName,
        tid: resolvedTid,
        mission: formMissionLevel,
        language: formLanguage,
      });
      saveTeamScoreStateLocal(resolvedTid, {
        score: teamProgress.score,
        solved: teamProgress.solved,
        unlocked: teamProgress.unlocked,
        hintsUsed: teamProgress.hintsUsed,
      });

      cleanupHintSystem();
      clearPenalty();
      playSound('powerUp');
      setScreenGlow(true);
      window.setTimeout(() => setScreenGlow(false), 1800);
      setRegFeedback({
        message: `✓ Welcome back, ${resolvedTeamName}`,
        type: 'success',
      });

      // Route to deep-link puzzle, saved step, or Step 2 Scanner
      const solvedS = new Set<number>(teamProgress.solved.map(Number));
      const unlockedS = new Set<number>(teamProgress.unlocked.map(Number));
      const deepPuzzle = pendingDeepLinkRef.current;

      if (deepPuzzle) {
        if (isPuzzleAllowed(deepPuzzle, solvedS, unlockedS)) {
          if (isStartingPuzzle(deepPuzzle)) {
            setUrlLockedPuzzle(deepPuzzle);
            setCurrentStep('startcode');
          } else {
            activatePuzzle(deepPuzzle);
            setCurrentStep(3);
          }
          pendingDeepLinkRef.current = null;
          return;
        }
        showToast(puzzleGateMessage(deepPuzzle, activePuzzles, null), 'error');
        pendingDeepLinkRef.current = null;
        setCurrentStep(2);
        return;
      }

      if (!isDifferentTeam) {
        const saved = getSavedGameState();
        if (saved.currentStep === 'startcode' && urlLockedPuzzle) {
          setCurrentStep('startcode');
          return;
        }
        if (saved.currentStep === 3 && saved.currentPuzzleId) {
          const restored = activePuzzles.find((p) => Number(p.id) === Number(saved.currentPuzzleId))
            || puzzleById.get(Number(saved.currentPuzzleId));
          if (restored && isPuzzleAllowed(restored, solvedS, unlockedS)) {
            activatePuzzle(restored, Boolean(saved.terminalLocked));
            setCurrentStep(3);
            return;
          }
        }
      }

      setCurrentStep(2);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Authentication failed.';
      setRegFeedback({ message: msg, type: 'error' });
      playSound('error');
    } finally {
      setIsRegSubmitting(false);
    }
  };

  const handleStep1Submit = (e: React.FormEvent) => {
    e.preventDefault();
    void performRegistrationLogin();
  };

  // Step 2: QR Scan / Manual Entry Handler
  const handleScanResult = useCallback(
    (rawCode: string) => {
      let code = standardizeString(rawCode);
      if (code.includes('?')) {
        try {
          const url = new URL(rawCode.trim(), window.location.origin);
          const linkid = url.searchParams.get('linkid');
          const memid = url.searchParams.get('memid');
          if (linkid) code = standardizeString(linkid);
          else if (memid) code = standardizeString(memid);
        } catch {
          // ignore
        }
      } else if (code.includes('/')) {
        const seg = code.split('/').filter(Boolean).pop();
        if (seg) code = seg;
      }

      // 1. Check meme library (O(1) lookup)
      const matchedMeme = memeById.get(code);
      if (matchedMeme) {
        playSound('success');
        setActiveMeme(matchedMeme);
        return;
      }

      // 2. Check puzzle catalog (O(1) lookup)
      const matchedPuzzle = puzzleByLinkId.get(code);
      if (!matchedPuzzle) {
        showToast('❌ Invalid Signal - Access Denied', 'error');
        playSound('error');
        return;
      }

      // 3. Enforce unlock graph progression
      if (!isPuzzleAllowed(matchedPuzzle, solvedSet, unlockedSet)) {
        if (teamKey) notepadBumpLocal(teamKey, 'scan', matchedPuzzle);
        const gateMsg = puzzleGateMessage(matchedPuzzle, puzzles, currentPuzzle);
        showToast(gateMsg, 'error');
        playSound('error');
        void recordPuzzleEventToDb({
          tid: currentTeamTid,
          teamName: currentTeam,
          mission: currentMissionLevel,
          language: currentLanguage,
          sessionId,
          action: 'QR_BLOCKED',
          status: 'BLOCKED',
          puzzleId: matchedPuzzle.id,
          linkid: matchedPuzzle.linkid,
          level: matchedPuzzle.level,
          totalScore: score,
          unlocked: unlockedIds,
          epoch,
        });
        return;
      }

      if (teamKey) notepadBumpLocal(teamKey, 'scan', matchedPuzzle);

      if (isStartingPuzzle(matchedPuzzle)) {
        setUrlLockedPuzzle(matchedPuzzle);
        setUnlockCode('');
        setUnlockFeedback(null);
        playSound('success');
        setCurrentStep('startcode');
      } else {
        activatePuzzle(matchedPuzzle);
        playSound('success');
        setCurrentStep(3);
      }
    },
    [
      memeById,
      puzzleByLinkId,
      puzzles,
      solvedSet,
      unlockedSet,
      teamKey,
      currentPuzzle,
      showToast,
      currentTeamTid,
      currentTeam,
      currentMissionLevel,
      currentLanguage,
      sessionId,
      score,
      unlockedIds,
      epoch,
      activatePuzzle,
    ]
  );

  // Startcode verification
  const handleUnlockSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const code = standardizeString(unlockCode);
    if (!code) {
      setUnlockFeedback({ message: 'Enter start key', type: 'error' });
      return;
    }

    const requestedPuzzle =
      urlLockedPuzzle && isStartingPuzzle(urlLockedPuzzle) ? urlLockedPuzzle : null;
    const matched = puzzles.find((p) => {
      if (requestedPuzzle && Number(p.id) !== Number(requestedPuzzle.id)) return false;
      return isStartingPuzzle(p) && standardizeString(p.startCode) === code;
    });

    if (matched) {
      setUnlockFeedback(null);
      activatePuzzle(matched);
      setCurrentStep(3);
      playSound('success');
      return;
    }

    void recordPuzzleEventToDb({
      tid: currentTeamTid,
      teamName: currentTeam,
      mission: currentMissionLevel,
      language: currentLanguage,
      sessionId,
      action: 'UNLOCK_FAILED',
      status: 'BLOCKED',
      puzzleId: requestedPuzzle?.id ?? 0,
      linkid: requestedPuzzle?.linkid ?? code,
      level: requestedPuzzle?.level ?? 1,
      totalScore: score,
      unlocked: unlockedIds,
      epoch,
    });
    setUnlockFeedback({ message: 'Incorrect key', type: 'error' });
    setUnlockShake(true);
    window.setTimeout(() => setUnlockShake(false), 500);
    playSound('error');
  };

  // Step 3: Submit Answer
  const handleSubmitAnswer = (e: React.FormEvent) => {
    e.preventDefault();
    if (answerLockedRef.current || terminalLockedRef.current || penaltyVisibleRef.current) return;

    const raw = answerValue.trim();
    if (!raw) {
      showToast('INPUT REQUIRED', 'error');
      return;
    }
    if (!currentPuzzle) {
      showToast('NO PUZZLE LOADED', 'error');
      return;
    }

    if (standardizeString(raw) !== standardizeString(currentPuzzle.answer)) {
      playSound('error');
      showToast('DECRYPTION FAILED', 'error');
      setScreenGlitch(true);
      window.setTimeout(() => setScreenGlitch(false), 400);
      setAnswerValue('');
      setAnswerShake(true);
      window.setTimeout(() => setAnswerShake(false), 500);
      if (teamKey) {
        const nb = notepadBumpLocal(teamKey, 'wrong', currentPuzzle);
        void recordPuzzleEventToDb({
          tid: currentTeamTid,
          teamName: currentTeam,
          mission: currentMissionLevel,
          language: currentLanguage,
          sessionId,
          action: 'WRONG_ATTEMPT',
          status: 'UNSOLVED',
          puzzleId: currentPuzzle.id,
          linkid: currentPuzzle.linkid,
          level: currentPuzzle.level,
          wrongAttempts: nb?.wrongAttempts ?? 1,
          tabSwitches: nb?.tabSwitches ?? 0,
          hintUsed: hintsUsedSet.has(currentPuzzle.id),
          scanCount: nb?.scanCount ?? 0,
          totalScore: score,
          unlocked: unlockedIds,
          epoch,
        });
      }
      return;
    }

    answerLockedRef.current = true;
    const pid = Number(currentPuzzle.id);
    const repeat = solvedSet.has(pid);
    const isEnd =
      !Array.isArray(currentPuzzle.nextPuzzleId) || currentPuzzle.nextPuzzleId.length === 0;
    const pointsDelta = repeat ? -(currentPuzzle.points || 0) : currentPuzzle.points || 0;
    const newScore = score + pointsDelta;
    const nextSolved = repeat ? solvedIds.slice() : [...solvedIds, pid];
    const nextUnlocked = computeLocalUnlocked(puzzles, nextSolved);
    const nbEntry = teamKey ? getPuzzleNotebook(teamKey)[String(pid)] || null : null;

    setScore(newScore);
    setSolvedIds(nextSolved);
    setUnlockedIds(nextUnlocked);

    if (teamKey) {
      saveTeamScoreStateLocal(teamKey, {
        score: newScore,
        solved: nextSolved,
        unlocked: nextUnlocked,
        hintsUsed: hintsUsedIds,
      });
      deletePuzzleNotebookEntry(teamKey, pid);
    }

    playSound('victory');
    showToast(
      repeat ? `REPEATED SOLVE: ${pointsDelta} pts` : `SIGNAL DECRYPTED! +${pointsDelta} pts`,
      repeat ? 'info' : 'success'
    );

    if (!isEnd) {
      setScreenGlow(true);
      window.setTimeout(() => setScreenGlow(false), 2000);
    }

    void recordPuzzleSolveToDb({
      tid: currentTeamTid,
      teamName: currentTeam,
      mission: currentMissionLevel,
      language: currentLanguage,
      sessionId,
      puzzle: currentPuzzle,
      repeat,
      pointsDelta,
      newScore,
      solved: nextSolved,
      unlocked: nextUnlocked,
      hintsUsed: hintsUsedIds,
      tabSwitchesTotal: tabSwitchCount,
      notebook: nbEntry,
      epoch,
    });

    setTerminalLockedSafe(false);
    setEnsureChecked(false);
    setRevealKey((k) => k + 1);
    setCurrentStep(4);
    playSound('hologram');
  };

  // Hint Request Handlers
  const handleRequestHint = () => {
    if (!currentPuzzle) return;
    const pid = Number(currentPuzzle.id);
    const alreadyPaid =
      hintsUsedSet.has(pid) || (currentTeam ? getHintUsedLocal(currentTeam, pid) : false);
    if (alreadyPaid) {
      setHintDisplayOpen(true);
      return;
    }
    if (!puzzleHasHint(currentPuzzle)) {
      showToast('No hint available for this puzzle.', 'info');
      return;
    }
    setHintRequestOpen(true);
    if (hintRequestTimeoutRef.current !== null) {
      window.clearTimeout(hintRequestTimeoutRef.current);
    }
    hintRequestTimeoutRef.current = window.setTimeout(() => {
      setHintRequestOpen(false);
      showToast('Hint request timed out', 'error');
    }, HINT_SETTINGS.hintRequestTimeout * 1000);
  };

  const handleConfirmHintRequest = () => {
    if (hintRequestTimeoutRef.current !== null) {
      window.clearTimeout(hintRequestTimeoutRef.current);
      hintRequestTimeoutRef.current = null;
    }
    setHintRequestOpen(false);
    startBrockCountdown(false);
  };

  const handleCancelHintRequest = () => {
    if (hintRequestTimeoutRef.current !== null) {
      window.clearTimeout(hintRequestTimeoutRef.current);
      hintRequestTimeoutRef.current = null;
    }
    cleanupHintSystem();
    playSound('error');
  };

  // Step 4 -> Scan Next Signal
  const handleContinueToQRScan = () => {
    const isEnd =
      currentPuzzle &&
      (!Array.isArray(currentPuzzle.nextPuzzleId) || currentPuzzle.nextPuzzleId.length === 0);
    if (isEnd) {
      showToast('🎉 CONGRATULATIONS! You have completed all puzzles!', 'success');
      playSound('victory');
      return;
    }
    setUnlockCode('');
    setUrlLockedPuzzle(null);
    setCurrentStep(2);
  };

  // Logout
  const handleConfirmSignOut = () => {
    setSignOutVisible(false);
    playSound('click');
    if ('vibrate' in navigator) navigator.vibrate(40);

    // Flush unsent notebook on signout
    if (teamKey && currentPuzzle && !solvedSet.has(Number(currentPuzzle.id))) {
      const nb = getPuzzleNotebook(teamKey)[String(currentPuzzle.id)];
      if (nb && nb.dirty) {
        void recordPuzzleEventToDb({
          tid: currentTeamTid,
          teamName: currentTeam,
          mission: currentMissionLevel,
          language: currentLanguage,
          sessionId,
          action: 'PUZZLE_ABANDONED',
          status: 'ABANDONED',
          puzzleId: currentPuzzle.id,
          linkid: currentPuzzle.linkid,
          level: currentPuzzle.level,
          wrongAttempts: nb.wrongAttempts,
          tabSwitches: nb.tabSwitches,
          hintUsed: nb.hintsUsed > 0,
          scanCount: nb.scanCount,
          totalScore: score,
          unlocked: unlockedIds,
          epoch,
        });
        deletePuzzleNotebookEntry(teamKey, currentPuzzle.id);
      }
    }

    cleanupHintSystem();
    clearPenalty();
    setTerminalLockedSafe(false);
    setEnsureChecked(false);
    answerLockedRef.current = false;

    setCurrentTeam('');
    setCurrentTeamTid('');
    setCurrentMissionLevel('');
    setSessionId(generateSessionId());
    setCurrentPuzzle(null);
    setUrlLockedPuzzle(null);
    setTabSwitchCount(0);
    setScore(0);
    setSolvedIds([]);
    setUnlockedIds([]);
    setHintsUsedIds([]);
    clearGameStateLocal();

    showToast('Trainer signed out. Data backed up!', 'success');
    setCurrentStep(0);
  };

  // Hardware Aux & Power Button Controls
  const handleAuxClick = (btnId: 1 | 2) => {
    playSound('click');
    if ('vibrate' in navigator) navigator.vibrate(20);

    const el = btnId === 1 ? aux1Ref.current : aux2Ref.current;
    if (el) {
      el.style.background = 'white';
      window.setTimeout(() => {
        if (el) el.style.background = '';
      }, 60);
    }

    if (btnId === 1) {
      const muted = toggleMute();
      showToast(muted ? 'Audio Suspended' : 'Audio Active', muted ? 'error' : 'success');
    } else {
      const playing = toggleBgm();
      showToast(playing ? 'BGM Active' : 'BGM Suspended', playing ? 'success' : 'info');
    }
  };

  const toggleCrtPower = () => {
    setIsCrtOn((prev) => {
      const next = !prev;
      playSound(next ? 'powerUp' : 'click');
      return next;
    });
  };

  const handlePowerTap = () => {
    if (isLoggedIn) {
      if (!signOutVisible) {
        setSignOutVisible(true);
        playSound('click');
      }
    } else {
      showToast('Trainer sign-in required', 'info');
      setCurrentStep(1);
    }
  };

  const clearPowerPress = () => {
    if (powerTimerRef.current !== null) {
      window.clearTimeout(powerTimerRef.current);
      powerTimerRef.current = null;
    }
  };

  // Re-check server epoch gently whenever logged in & returning to Step 2
  useEffect(() => {
    if (!isLoggedIn || currentStep !== 2) return;
    fetchServerGameEpoch()
      .then((serverEpoch) => {
        if (serverEpoch > epoch) {
          wipeAllLocalGameStorage(serverEpoch);
          setEpoch(serverEpoch);
          setScore(0);
          setSolvedIds([]);
          setUnlockedIds(computeLocalUnlocked(puzzles, []));
          setHintsUsedIds([]);
          showToast('New game epoch started by admin!', 'info');
        }
      })
      .catch(() => {});
  }, [isLoggedIn, currentStep, epoch, puzzles, showToast]);

  // Derived HUD strings
  const hudLevel =
    isLoggedIn && currentMissionLevel
      ? (currentMissionLevel.split('_')[0] || 'L1').replace('L', '').padStart(2, '0')
      : '00';
  const hudType =
    isLoggedIn && currentMissionLevel
      ? currentMissionLevel.split('_')[1] || 'NORMAL'
      : 'SYS';
  const hudTeamName = isLoggedIn
    ? currentTeam.length > 20
      ? `${currentTeam.substring(0, 20)}...`
      : currentTeam
    : 'NO TEAM';

  const nextPuzzles = useMemo(() => getNextPuzzles(puzzles, currentPuzzle), [puzzles, currentPuzzle]);

  return (
    <div className="pokedex-viewport bg-[#050810] font-mono overflow-x-hidden touch-manipulation">
      <div className="pokedex-shell flex flex-col">
        {/* Top Header Section */}
        <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 sm:gap-3 mb-3 sm:mb-4 px-2 pt-1 flex-shrink-0">
          {/* Blue Camera Orb */}
          <div className="justify-self-start w-[clamp(32px,7.5vmin,56px)] h-[clamp(32px,7.5vmin,56px)] rounded-full flex items-center justify-center relative flex-shrink-0">
            <div className="absolute -inset-1 bg-blue-400/30 rounded-full blur-sm"></div>
            <div className="absolute inset-0 rounded-full bg-gradient-to-br from-blue-400 via-blue-500 to-blue-600 border-2 sm:border-[3px] md:border-4 border-white shadow-[inset_0_-4px_8px_rgba(0,0,0,0.3),inset_0_4px_8px_rgba(255,255,255,0.2),0_4px_12px_rgba(0,0,0,0.4)] overflow-hidden">
              <div className="absolute inset-0 rounded-full bg-gradient-to-br from-transparent via-blue-300/20 to-transparent"></div>
              <div className="absolute top-[12%] left-[12%] w-[22%] h-[22%] bg-gradient-to-br from-white to-blue-100 rounded-full opacity-70"></div>
              <div className="absolute top-[8%] right-[14%] w-[16%] h-[16%] bg-gradient-to-br from-white/60 to-transparent rounded-full blur-[1px]"></div>
              <div className="absolute inset-[16%] border border-white/30 rounded-full"></div>
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="w-[14%] h-[14%] bg-white/40 rounded-full blur-[1px]"></div>
              </div>
            </div>
          </div>

          {/* Center Brand Lockup */}
          <div className="brand-lockup justify-self-center flex-shrink-0 text-center flex flex-col justify-center items-center">
            <div className="brand-mark-row">
              <img
                src="/assets/img/pykachu.png"
                alt="Pykachu"
                loading="lazy"
                className="brand-pykachu select-none pointer-events-none"
              />
              <img
                src="/assets/img/go.png"
                alt="Go"
                loading="lazy"
                className="brand-go select-none pointer-events-none"
              />
            </div>
            <p className="brand-tagline text-[10px] sm:text-xs md:text-sm text-slate-200 font-medium text-center">
              Decode Code. Capture Pikachu.
            </p>
          </div>

          {/* Red/Yellow/Green Status LEDs */}
          <div className="justify-self-end flex gap-1 sm:gap-1.5 pt-1 sm:pt-1.5 flex-shrink-0">
            <div className="w-[clamp(9px,2.2vmin,14px)] h-[clamp(9px,2.2vmin,14px)] rounded-full relative">
              <div className="absolute inset-0 rounded-full bg-gradient-to-br from-red-500 via-red-600 to-red-700 border border-red-900/80"></div>
              <div className="absolute inset-0 rounded-full shadow-[inset_0_1px_2px_rgba(255,255,255,0.3),inset_0_-1px_2px_rgba(0,0,0,0.5)]"></div>
              <div className="absolute top-[15%] left-[15%] w-[35%] h-[35%] bg-white/60 rounded-full blur-[0.5px]"></div>
              <div
                className="absolute inset-0 rounded-full bg-red-500/30 blur-[1px] animate-pulse"
                style={{ animationDuration: '2s' }}
              ></div>
            </div>

            <div className="w-[clamp(9px,2.2vmin,14px)] h-[clamp(9px,2.2vmin,14px)] rounded-full relative">
              <div className="absolute inset-0 rounded-full bg-gradient-to-br from-yellow-300 via-yellow-400 to-yellow-500 border border-yellow-700/80"></div>
              <div className="absolute inset-0 rounded-full shadow-[inset_0_1px_2px_rgba(255,255,255,0.4),inset_0_-1px_2px_rgba(0,0,0,0.4)]"></div>
              <div className="absolute top-[15%] left-[15%] w-[35%] h-[35%] bg-white/70 rounded-full blur-[0.5px]"></div>
              <div
                className="absolute inset-0 rounded-full bg-yellow-400/30 blur-[1px] animate-pulse"
                style={{ animationDuration: '2.5s', animationDelay: '0.5s' }}
              ></div>
            </div>

            <div className="w-[clamp(9px,2.2vmin,14px)] h-[clamp(9px,2.2vmin,14px)] rounded-full relative">
              <div className="absolute inset-0 rounded-full bg-gradient-to-br from-green-400 via-green-500 to-green-600 border border-green-800/80"></div>
              <div className="absolute inset-0 rounded-full shadow-[inset_0_1px_2px_rgba(255,255,255,0.3),inset_0_-1px_2px_rgba(0,0,0,0.5)]"></div>
              <div className="absolute top-[15%] left-[15%] w-[35%] h-[35%] bg-white/60 rounded-full blur-[0.5px]"></div>
              <div
                className="absolute inset-0 rounded-full bg-green-500/30 blur-[1px] animate-pulse"
                style={{ animationDuration: '3s', animationDelay: '1s' }}
              ></div>
            </div>
          </div>
        </div>

        {/* Main CRT Display Area */}
        <div className="crt-container flex-1 min-h-0">
          <div
            ref={screenRef}
            id="screen"
            className={`crt-screen overflow-y-auto scrollable relative${
              screenGlow ? ' premium-glow' : ''
            }${screenGlitch ? ' glitch-active' : ''}`}
            style={
              isCrtOn
                ? { opacity: 1 }
                : { filter: 'brightness(0) contrast(2)', opacity: 0.1 }
            }
          >
            <ToastContainer toasts={toasts} />

            <canvas
              ref={celebrationCanvasRef}
              id="celebrationCanvas"
              className="absolute inset-0 w-full h-full pointer-events-none z-[100]"
            ></canvas>

            <LoaderSplash booted={booted} />

            {/* Full-Width Minimal Internal Status HUD */}
            <div className="internal-status-bar">
              <div
                id="statusLvl"
                className={`status-item ${isLoggedIn ? 'is-filled' : 'is-empty'} !p-0 !gap-1`}
              >
                <span className="material-symbols-rounded text-xs sm:text-sm">analytics</span>
                <span id="teamLevelDisplay" className="status-val text-[10px] sm:text-[11px]">
                  {hudLevel}
                </span>
              </div>

              <div className="status-divider"></div>

              <div
                id="statusTeam"
                className={`status-item ${isLoggedIn ? 'is-filled' : 'is-empty'} !p-0 !gap-1`}
              >
                <span className="material-symbols-rounded text-sm sm:text-base">
                  {isLoggedIn ? 'verified_user' : 'shield_person'}
                </span>
                <span id="teamNameInput" className="team-val font-bold text-[10px] sm:text-[11px]">
                  {hudTeamName}
                </span>
              </div>

              <div className="status-divider"></div>

              <div
                id="statusType"
                className={`status-item ${isLoggedIn ? 'is-filled' : 'is-empty'} !p-0 !gap-1`}
              >
                <span id="teamTypeDisplay" className="status-val text-[10px] sm:text-[11px]">
                  {hudType}
                </span>
                <span className="material-symbols-rounded text-xs sm:text-sm">dynamic_form</span>
              </div>
            </div>

            <Step0Rules
              active={currentStep === 0}
              onAccept={() => setCurrentStep(1)}
            />

            <Step1Login
              active={currentStep === 1}
              teamName={formTeamName}
              onTeamNameChange={setFormTeamName}
              securityKey={formSecurityKey}
              onSecurityKeyChange={setFormSecurityKey}
              language={formLanguage}
              onLanguageChange={setFormLanguage}
              missionLevel={formMissionLevel}
              onMissionLevelChange={setFormMissionLevel}
              config={config}
              feedback={regFeedback}
              shakeField={regShakeField}
              isSubmitting={isRegSubmitting}
              onSubmit={handleStep1Submit}
            />

            <Step2Scanner
              active={currentStep === 2}
              onScanResult={handleScanResult}
              onShowToast={showToast}
              onOpenCameraGuide={(reason) =>
                setCameraGuideState({ visible: true, reason })
              }
            />

            <StartCodeStep
              active={currentStep === 'startcode'}
              lockedPuzzle={urlLockedPuzzle}
              unlockCode={unlockCode}
              onUnlockCodeChange={setUnlockCode}
              feedback={unlockFeedback}
              shakeInput={unlockShake}
              onSubmit={handleUnlockSubmit}
              onBack={() => setCurrentStep(2)}
            />

            <Step3Puzzle
              active={currentStep === 3}
              puzzle={currentPuzzle}
              language={currentLanguage}
              questionText={getPuzzleQuestion(currentPuzzle, currentLanguage)}
              elapsedSeconds={elapsedSeconds}
              tabSwitchCount={tabSwitchCount}
              answerValue={answerValue}
              onAnswerChange={setAnswerValue}
              onSubmitAnswer={handleSubmitAnswer}
              shakeAnswer={answerShake}
              answerInputRef={answerInputRef}
              hasHint={puzzleHasHint(currentPuzzle)}
              hintRequestOpen={hintRequestOpen}
              hintPenaltyOpen={hintPenaltyOpen}
              hintPenaltySeconds={hintPenaltySeconds}
              hintPenaltyRingIteration={hintPenaltyRingIteration}
              hintFocusLost={hintFocusLost}
              hintDisplayOpen={hintDisplayOpen}
              hintText={
                currentPuzzle && typeof currentPuzzle.hint === 'string'
                  ? currentPuzzle.hint
                  : ''
              }
              terminalLocked={terminalLocked}
              ensureChecked={ensureChecked}
              onEnsureCheckedChange={setEnsureChecked}
              onUnlockTerminal={handleUnlockTerminal}
              onRequestHint={handleRequestHint}
              onConfirmHintRequest={handleConfirmHintRequest}
              onCancelHintRequest={handleCancelHintRequest}
              onCloseHintPopup={() => setHintDisplayOpen(false)}
            />

            <Step4Success
              active={currentStep === 4}
              puzzle={currentPuzzle}
              nextPuzzles={nextPuzzles}
              missionLevel={currentMissionLevel}
              revealKey={revealKey}
              isLoggedIn={isLoggedIn}
              celebrationCanvasRef={celebrationCanvasRef}
              screenRef={screenRef}
              onContinueToQRScan={handleContinueToQRScan}
            />

            <PenaltyOverlay
              visible={penaltyVisible}
              seconds={penaltySeconds}
              ringIteration={penaltyRingIteration}
            />

            <MemePlayerOverlay
              meme={activeMeme}
              onClose={() => setActiveMeme(null)}
              onShowToast={showToast}
            />

            <SignOutOverlay
              visible={signOutVisible}
              teamName={currentTeam}
              onConfirm={handleConfirmSignOut}
              onCancel={() => {
                setSignOutVisible(false);
                showToast('Stay in battle, trainer!', 'info');
              }}
            />

            <CameraGuideOverlay
              visible={cameraGuideState.visible}
              reason={cameraGuideState.reason}
              onClose={() =>
                setCameraGuideState((prev) => ({ ...prev, visible: false }))
              }
              onShowToast={showToast}
            />
          </div>
        </div>

        {/* Compact Auxiliary Interface */}
        <div
          className="flex justify-between items-center mt-2 px-2 flex-shrink-0"
          style={{ paddingBottom: 'max(8px, env(safe-area-inset-bottom, 8px))' }}
        >
          <div className="flex gap-2">
            <div
              ref={aux1Ref}
              id="aux-btn-1"
              className="pokedex-button-bar w-10 h-3 sm:w-12 sm:h-3.5 bg-slate-800 rounded-full shadow-lg cursor-pointer hover:bg-slate-700 active:translate-y-0.5 transition-all min-h-[20px]"
              onClick={() => handleAuxClick(1)}
              role="button"
              aria-label={`Audio toggle button (${getMuted() ? 'muted' : 'active'})`}
              tabIndex={0}
            ></div>
            <div
              ref={aux2Ref}
              id="aux-btn-2"
              className="pokedex-button-bar w-10 h-3 sm:w-12 sm:h-3.5 bg-slate-800 rounded-full shadow-lg cursor-pointer hover:bg-slate-700 active:translate-y-0.5 transition-all min-h-[20px]"
              onClick={() => handleAuxClick(2)}
              role="button"
              aria-label="BGM toggle button"
              tabIndex={0}
            ></div>
          </div>

          <div
            id="power-button"
            className="pokedex-button-alt w-8 h-8 sm:w-9 sm:h-9 md:w-10 md:h-10 rounded-full flex items-center justify-center cursor-pointer group min-h-[32px] min-w-[32px]"
            role="button"
            aria-label="Sign in/out status (hold for power)"
            tabIndex={0}
            onPointerDown={(e) => {
              if (e.pointerType === 'mouse' && e.button !== 0) return;
              powerLongPressedRef.current = false;
              clearPowerPress();
              powerTimerRef.current = window.setTimeout(() => {
                powerLongPressedRef.current = true;
                toggleCrtPower();
              }, 650);
            }}
            onPointerUp={() => {
              clearPowerPress();
              if (powerLongPressedRef.current) {
                powerLongPressedRef.current = false;
                return;
              }
              handlePowerTap();
            }}
            onPointerCancel={clearPowerPress}
            onPointerLeave={clearPowerPress}
            onKeyDown={(e) => {
              if (e.key !== 'Enter' && e.key !== ' ') return;
              e.preventDefault();
              handlePowerTap();
            }}
          >
            <div className="w-5 h-5 sm:w-5.5 sm:h-5.5 md:w-6 md:h-6 rounded-full bg-slate-900 shadow-inner flex items-center justify-center group-active:scale-95 transition-transform">
              <div
                id="power-led"
                className={`w-2 h-2 sm:w-2.5 sm:h-2.5 rounded-full ${
                  isLoggedIn ? 'session-on' : 'session-idle'
                } transition-all`}
              ></div>
            </div>
          </div>
        </div>
      </div>

      <SecurityBarrier screenRef={screenRef} disabled={currentStep !== 3 || !isLoggedIn} />
      <PortraitLockOverlay />
    </div>
  );
};
