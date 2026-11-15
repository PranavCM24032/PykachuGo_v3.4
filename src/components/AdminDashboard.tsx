import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  adminResetAllData,
  fetchAdminLogs,
  loadAdminCatalog,
  verifyAdminCredentials,
  type NormalizedAdminLogRow,
} from '../services/gameBackend';
import { CustomSelect } from './CustomSelect';
import { AdminCreatorPanel } from './AdminCreatorPanel';
import {
  STORAGE_KEYS,
  type GameConfig,
  type MemeEntry,
  type Puzzle,
  type TeamEntry,
} from '../types/game';

type AdminTab = 'REG' | 'L1' | 'L2' | 'L3' | 'LB' | 'ROSTER' | 'CREATE';
type SecurityFilter = 'ALL' | 'HINT' | 'MALPRACTICE';

interface LevelRecord {
  lastActive: string;
  tid: string;
  teamName: string;
  mission: string;
  puzzleId: number;
  status: string;
  wrongAttempts: number;
  tabSwitches: number;
  hintUsed: boolean;
  timestamp: string;
  pointsEarned: number;
  pointsLost: number;
  points?: number;
  hasPointData: boolean;
  totalScore: number;
  unlockedPuzzles: string;
}

interface TeamMapRecord {
  name: string;
  teamName: string;
  tid: string;
  registered: boolean;
  regTime: string;
  language: string;
  sessionId: string;
  mission: string;
  levels: {
    L1: LevelRecord[];
    L2: LevelRecord[];
    L3: LevelRecord[];
  };
}

const L_COLS =
  '30px 88px 1.4fr 90px 76px 34px 36px 36px 36px 70px 60px 46px 46px';
const REG_COLS = '35px 140px 90px 180px 110px 130px';
const LB_COLS = '40px 88px 1fr 120px 58px 58px 58px 90px';
const ROSTER_COLS = '35px 1.4fr 100px 110px 2fr';

function missionMatchesFilter(mission: string, typeFilter: string): boolean {
  if (!typeFilter || typeFilter === 'ALL') return true;
  const m = String(mission || '').trim().toUpperCase();
  if (!m || m === 'UNASSIGNED' || m === 'UNKNOWN') return false;
  if (m === typeFilter) return true;
  return m.split(/[\s_]+/).includes(typeFilter);
}

function matchesLevel(missionStr: string, targetLvl: string): boolean {
  if (!missionStr) return false;
  const m = missionStr.toUpperCase();
  const lvl = targetLvl.toUpperCase();
  const num = lvl.replace('L', '');
  return m.includes(lvl) || m.includes(`LEVEL_${num}`) || m.includes(`LEVEL ${num}`);
}

function formatTime(ts: string): string {
  if (!ts) return '-';
  const d = new Date(ts);
  return !Number.isNaN(d.getTime())
    ? d.toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      })
    : ts;
}

export const AdminDashboard: React.FC = () => {
  const [adminSession, setAdminSession] = useState<{ name: string; password: string }>(() => {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEYS.adminSessionKey);
      if (!raw) return { name: '', password: '' };
      const parsed = JSON.parse(raw) as { name?: string; password?: string };
      return {
        name: String(parsed?.name || ''),
        password: String(parsed?.password || ''),
      };
    } catch {
      return { name: '', password: '' };
    }
  });
  const adminKey = adminSession.password;
  const [adminNameInput, setAdminNameInput] = useState('');
  const [passwordInput, setPasswordInput] = useState('');
  const [isAdmin, setIsAdmin] = useState(false);
  const [authChecking, setAuthChecking] = useState(true);
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState<string>('');

  const [teams, setTeams] = useState<TeamEntry[]>([]);
  const [memes, setMemes] = useState<MemeEntry[]>([]);
  const [puzzles, setPuzzles] = useState<Puzzle[]>([]);
  const [config, setConfig] = useState<GameConfig | null>(null);
  const [liveLogs, setLiveLogs] = useState<NormalizedAdminLogRow[]>([]);
  const [displayedLogs, setDisplayedLogs] = useState<NormalizedAdminLogRow[]>([]);

  const [autoRefresh, setAutoRefresh] = useState(true);
  const [hasLiveData, setHasLiveData] = useState(false);
  const [lastUpdatedText, setLastUpdatedText] = useState('SYNCING...');
  const [systemStatusText, setSystemStatusText] = useState('ONLINE');
  const [systemStatusClass, setSystemStatusClass] = useState('text-green-400');

  const [activeTab, setActiveTab] = useState<AdminTab>('REG');
  const [searchTerm, setSearchTerm] = useState('');
  const [typeFilter, setTypeFilter] = useState('ALL');
  const [levelFilter, setLevelFilter] = useState('ALL');
  const [securityFilter, setSecurityFilter] = useState<SecurityFilter>('ALL');

  const [confirmMode, setConfirmMode] = useState<
    'none' | 'new_start' | 'reset_1' | 'reset_2'
  >('none');
  const [resetting, setResetting] = useState(false);
  const [tablePage, setTablePage] = useState(1);
  const ROWS_PER_PAGE = 100;

  const nextSinceRowRef = useRef<number>(2);
  const lastPollEpochRef = useRef<number>(0);
  const pollInFlightRef = useRef<boolean>(false);

  const reloadCatalog = useCallback(
    async (keyOverride?: string) => {
      const key = keyOverride ?? adminKey;
      const data = await loadAdminCatalog(key);
      setTeams(data.teams);
      setMemes(data.memes);
      setPuzzles(data.puzzles);
      setConfig(data.config);
    },
    [adminKey]
  );

  // Verify stored session credentials against /data/admin.json once on mount
  useEffect(() => {
    let cancelled = false;
    const savedName = adminSession.name.trim();
    const savedPass = adminSession.password.trim();
    if (!savedName || !savedPass) {
      setIsAdmin(false);
      setAuthChecking(false);
      return;
    }
    setAuthChecking(true);
    verifyAdminCredentials(savedName, savedPass)
      .then((ok) => {
        if (cancelled) return;
        setIsAdmin(ok);
        if (!ok) {
          try {
            sessionStorage.removeItem(STORAGE_KEYS.adminSessionKey);
          } catch {
            // ignore
          }
          setAdminSession({ name: '', password: '' });
        }
      })
      .catch(() => {
        if (!cancelled) setIsAdmin(false);
      })
      .finally(() => {
        if (!cancelled) setAuthChecking(false);
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load Google Sheet catalog when authenticated
  useEffect(() => {
    if (!isAdmin || !adminKey) return;
    reloadCatalog(adminKey).catch((err) => {
      console.warn('Admin failed loading Sheet catalog:', err);
    });
  }, [isAdmin, adminKey, reloadCatalog]);

  // Differential delta log polling (reads only new rows >= sinceRow every 5s)
  useEffect(() => {
    if (!isAdmin || !adminKey) return;
    let cancelled = false;

    const pollOnce = async () => {
      if (pollInFlightRef.current) return;
      pollInFlightRef.current = true;
      try {
        const res = await fetchAdminLogs(adminKey, nextSinceRowRef.current);
        if (cancelled) return;

        const epochChanged =
          lastPollEpochRef.current !== 0 && res.epoch !== lastPollEpochRef.current;
        lastPollEpochRef.current = res.epoch;

        if (res.fullSnapshot) {
          nextSinceRowRef.current = Math.max(2, res.nextSinceRow);
          setLiveLogs(res.logs);
        } else if (epochChanged) {
          nextSinceRowRef.current = 2;
          const fresh = await fetchAdminLogs(adminKey, 2);
          if (cancelled) return;
          nextSinceRowRef.current = Math.max(2, fresh.nextSinceRow);
          setLiveLogs(fresh.logs);
        } else {
          nextSinceRowRef.current = Math.max(2, res.nextSinceRow);
          if (res.logs.length > 0) {
            setLiveLogs((prev) => {
              if (prev.length === 0) return res.logs;
              const seen = new Set(prev.map((l) => l.id));
              const appended = res.logs.filter((l) => !seen.has(l.id));
              return appended.length > 0 ? [...prev, ...appended] : prev;
            });
          }
        }

        setHasLiveData(true);
      } catch (err) {
        if (cancelled) return;
        console.warn('Admin Sheet polling error:', err);
        const isAuthError = err instanceof Error && /unauthorized/i.test(err.message);
        setHasLiveData(false);
        setLastUpdatedText(isAuthError ? 'CHECK ADMIN_PASSWORD PROP' : 'RETRYING...');
        setSystemStatusText(isAuthError ? 'AUTH MISMATCH' : 'OFFLINE');
        setSystemStatusClass('text-pink-500');
      } finally {
        pollInFlightRef.current = false;
      }
    };

    void pollOnce();
    if (!autoRefresh) return () => { cancelled = true; };

    const intervalId = window.setInterval(() => {
      void pollOnce();
    }, 5000);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [isAdmin, adminKey, autoRefresh]);

  // Apply live updates to visible dashboard unless paused (250ms burst coalesce)
  useEffect(() => {
    if (!autoRefresh) return;

    const applyUpdate = () => {
      setDisplayedLogs(liveLogs);
      if (hasLiveData) {
        setLastUpdatedText(
          `UPDATED: ${new Date().toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit',
          })}`
        );
        setSystemStatusText('ONLINE');
        setSystemStatusClass('text-green-400');
      }
    };

    if (displayedLogs.length === 0 || liveLogs.length === 0) {
      applyUpdate();
      return;
    }

    const timer = window.setTimeout(applyUpdate, 250);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveLogs, autoRefresh, hasLiveData]);

  const puzzleLinkById = useMemo(() => {
    const map: Record<number, string> = {};
    puzzles.forEach((p) => {
      if (p.id > 0 && p.linkid) map[Number(p.id)] = p.linkid;
    });
    return map;
  }, [puzzles]);

  const typeSelectOptions = useMemo(() => {
    const base = [{ value: 'ALL', label: 'ALL TYPES' }];
    if (config?.missionTypes) {
      return [...base, ...config.missionTypes];
    }
    return base;
  }, [config]);

  const levelSelectOptions = useMemo(() => {
    const base = [{ value: 'ALL', label: 'ALL LEVELS' }];
    if (config?.missionGroups) {
      const items = config.missionGroups.map((g) => ({
        value: g.level,
        label: g.label.replace(/:.*/, '').trim(),
      }));
      return [...base, ...items];
    }
    return base;
  }, [config]);

  // Build unified team map with O(1) TID + Name indexing (handles 300 teams × 40 puzzles = ~12k logs fast)
  const { teamMap, totalSolved } = useMemo(() => {
    const map: Record<string, TeamMapRecord> = {};
    const byTidMap = new Map<string, TeamMapRecord>();

    teams.forEach((t) => {
      const name = String(t.team || '').trim().toUpperCase();
      if (!name) return;
      const rec: TeamMapRecord = {
        name,
        teamName: t.team,
        tid: t.tid || '',
        registered: false,
        regTime: '',
        language: '',
        sessionId: '',
        mission: 'UNASSIGNED',
        levels: { L1: [], L2: [], L3: [] },
      };
      map[name] = rec;
      const normTid = String(t.tid || '').trim().toUpperCase();
      if (normTid) byTidMap.set(normTid, rec);
    });

    displayedLogs.forEach((log) => {
      const name = String(log.teamName || '').trim().toUpperCase();
      if (!name || name === 'UNKNOWN' || name === 'NO TEAM') return;

      const normTid = String(log.tid || '').trim().toUpperCase();
      let t = (normTid ? byTidMap.get(normTid) : undefined) || map[name] || null;
      if (!t) {
        t = {
          name,
          teamName: log.teamName || name,
          tid: log.tid || '',
          registered: false,
          regTime: '',
          language: '',
          sessionId: log.sessionId || '',
          mission: log.mission || 'UNKNOWN',
          levels: { L1: [], L2: [], L3: [] },
        };
        map[name] = t;
        if (normTid) byTidMap.set(normTid, t);
      }

      if (log.tid && !t.tid) {
        t.tid = log.tid;
        if (normTid) byTidMap.set(normTid, t);
      }
      if (log.mission && (t.mission === 'UNASSIGNED' || t.mission === 'UNKNOWN')) {
        t.mission = log.mission;
      }
      if (log.sessionId && !t.sessionId) t.sessionId = log.sessionId;

      if (log.action === 'REGISTRATION') {
        t.registered = true;
        t.regTime = log.registeredAt || log.lastActive || log.timestamp || '';
        t.language = log.language || t.language || 'PYTHON';
        if (log.mission) t.mission = log.mission;
      } else if (log.action === 'SUMMARY' && log.level) {
        const lvl = log.level.toUpperCase() as 'L1' | 'L2' | 'L3';
        if (lvl === 'L1' || lvl === 'L2' || lvl === 'L3') {
          t.levels[lvl].push({
            lastActive: log.lastActive || log.timestamp || '',
            tid: log.tid || t.tid || '',
            teamName: log.teamName || t.teamName,
            mission: log.mission || t.mission,
            puzzleId: Number(log.puzzleId || 0),
            status: log.status || 'ACTIVE',
            wrongAttempts: Number(log.wrongAttempts || 0),
            tabSwitches: Number(log.tabSwitches || 0),
            hintUsed: Boolean(log.hintUsed),
            timestamp: log.timestamp || '',
            pointsEarned: Number(log.pointsEarned || 0),
            pointsLost: Number(log.pointsLost || 0),
            points: Number(log.points || 0),
            hasPointData: true,
            totalScore: Number(log.totalScore || 0),
            unlockedPuzzles: log.unlockedPuzzles || '',
          });
        }
      }
    });

    let solvedCount = 0;
    Object.values(map).forEach((t) => {
      (['L1', 'L2', 'L3'] as const).forEach((l) => {
        t.levels[l].forEach((r) => {
          if (r.status === 'SOLVED') solvedCount++;
        });
      });
    });

    return { teamMap: map, totalSolved: solvedCount };
  }, [teams, displayedLogs]);

  const normalizedSearch = searchTerm.trim().toLowerCase();

  // Filtered rows per tab
  const filteredStandardTeams = useMemo(() => {
    let list = Object.values(teamMap);
    if (normalizedSearch) {
      list = list.filter(
        (t) =>
          t.name.toLowerCase().includes(normalizedSearch) ||
          String(t.tid || '').toLowerCase().includes(normalizedSearch)
      );
    }

    if (activeTab === 'REG') {
      list = list.filter((t) => t.registered);
    } else if (activeTab === 'L1' || activeTab === 'L2' || activeTab === 'L3') {
      list = list.filter(
        (t) =>
          t.levels[activeTab].length > 0 || matchesLevel(t.mission, activeTab)
      );
    }

    if (levelFilter !== 'ALL') {
      const lvlKey = levelFilter as 'L1' | 'L2' | 'L3';
      list = list.filter(
        (t) =>
          (t.levels[lvlKey] && t.levels[lvlKey].length > 0) ||
          matchesLevel(t.mission, levelFilter)
      );
    }

    if (typeFilter !== 'ALL') {
      list = list.filter((t) => missionMatchesFilter(t.mission, typeFilter));
    }

    const levelsForFilter: Array<'L1' | 'L2' | 'L3'> =
      levelFilter !== 'ALL'
        ? [levelFilter as 'L1' | 'L2' | 'L3']
        : activeTab === 'LB'
          ? ['L1', 'L2', 'L3']
          : activeTab === 'L1' || activeTab === 'L2' || activeTab === 'L3'
            ? [activeTab]
            : ['L1', 'L2', 'L3'];

    if (securityFilter === 'HINT') {
      list = list.filter((t) => {
        if (activeTab === 'REG') return false;
        return levelsForFilter.some((l) => t.levels[l]?.some((r) => r.hintUsed));
      });
    } else if (securityFilter === 'MALPRACTICE') {
      list = list.filter((t) => {
        if (activeTab === 'REG') return false;
        return levelsForFilter.some((l) =>
          t.levels[l]?.some((r) => (r.tabSwitches || 0) > 0)
        );
      });
    }

    return list;
  }, [
    teamMap,
    normalizedSearch,
    activeTab,
    levelFilter,
    typeFilter,
    securityFilter,
  ]);

  const lbRows = useMemo(() => {
    const leaderboardLevels: Array<'L1' | 'L2' | 'L3'> =
      levelFilter === 'ALL' ? ['L1', 'L2', 'L3'] : [levelFilter as 'L1' | 'L2' | 'L3'];

    let rows = Object.values(teamMap).map((t) => {
      let solved = 0;
      let totalHints = 0;
      let totalTabs = 0;
      let pointsFromRecords = 0;
      let hasPointData = false;
      let latestTimestamp = '';
      let latestTimestampMs = -1;
      let hasHint = false;
      let hasMalpractice = false;
      let latestScore = 0;

      leaderboardLevels.forEach((l) => {
        const recs = t.levels[l];
        if (!Array.isArray(recs)) return;
        recs.forEach((r) => {
          if (r.status === 'SOLVED') solved++;
          if (r.hintUsed) {
            totalHints++;
            hasHint = true;
          }
          totalTabs += Math.max(0, r.tabSwitches || 0);
          if (r.tabSwitches > 0) hasMalpractice = true;

          if (r.status === 'SOLVED' || r.status === 'REPEAT_SOLVE') {
            pointsFromRecords += Number(r.points || 0);
            hasPointData = true;
          }

          const recordTimestamp = r.timestamp || '';
          const ms = recordTimestamp ? new Date(recordTimestamp).getTime() : NaN;
          if (Number.isFinite(ms) && ms >= latestTimestampMs) {
            latestTimestampMs = ms;
            latestTimestamp = recordTimestamp;
            latestScore = Number(r.totalScore || 0);
          }
        });
      });

      if (!latestTimestamp) latestTimestamp = t.regTime || '';
      const pts = hasPointData ? pointsFromRecords : latestScore;

      return {
        name: t.name,
        teamName: t.teamName,
        tid: t.tid || '-',
        timestamp: latestTimestamp,
        solved,
        totalHints,
        totalTabs,
        pts,
        mission: t.mission,
        hasHint,
        hasMalpractice,
      };
    });

    if (normalizedSearch) {
      rows = rows.filter(
        (r) =>
          r.name.toLowerCase().includes(normalizedSearch) ||
          String(r.tid || '').toLowerCase().includes(normalizedSearch)
      );
    }
    if (typeFilter !== 'ALL') {
      rows = rows.filter((r) => missionMatchesFilter(r.mission, typeFilter));
    }
    if (securityFilter === 'HINT') rows = rows.filter((r) => r.hasHint);
    if (securityFilter === 'MALPRACTICE') rows = rows.filter((r) => r.hasMalpractice);

    rows.sort((a, b) => b.pts - a.pts || a.name.localeCompare(b.name));
    return rows;
  }, [teamMap, levelFilter, normalizedSearch, typeFilter, securityFilter]);

  const rosterRows = useMemo(() => {
    let roster = teams.slice();
    if (normalizedSearch) {
      roster = roster.filter((t) => {
        const haystack = (
          (t.team || '') +
          ' ' +
          (t.tid || '') +
          ' ' +
          (Array.isArray(t.team_members) ? t.team_members.join(' ') : '')
        ).toLowerCase();
        return haystack.includes(normalizedSearch);
      });
    }
    if (typeFilter !== 'ALL' || levelFilter !== 'ALL') {
      roster = roster.filter((t) => {
        const rec = teamMap[String(t.team || '').trim().toUpperCase()];
        if (!rec) return false;
        if (typeFilter !== 'ALL' && !missionMatchesFilter(rec.mission, typeFilter)) {
          return false;
        }
        if (levelFilter !== 'ALL') {
          const lvlKey = levelFilter as 'L1' | 'L2' | 'L3';
          const hasLevel = rec.levels[lvlKey] && rec.levels[lvlKey].length > 0;
          if (!hasLevel && !matchesLevel(rec.mission, levelFilter)) return false;
        }
        return true;
      });
    }
    return roster;
  }, [teams, teamMap, normalizedSearch, typeFilter, levelFilter]);

  const levelAssertRows = useMemo(() => {
    if (activeTab !== 'L1' && activeTab !== 'L2' && activeTab !== 'L3') return [];
    const rows: Array<{ team: TeamMapRecord; record: LevelRecord | null }> = [];
    filteredStandardTeams.forEach((team) => {
      const recs = team.levels[activeTab];
      if (recs.length) {
        recs.forEach((r) => rows.push({ team, record: r }));
      } else {
        rows.push({ team, record: null });
      }
    });
    return rows;
  }, [filteredStandardTeams, activeTab]);

  const activeTeamCount =
    activeTab === 'LB'
      ? lbRows.length
      : activeTab === 'ROSTER'
        ? rosterRows.length
        : filteredStandardTeams.length;

  useEffect(() => {
    setTablePage(1);
  }, [activeTab, normalizedSearch, typeFilter, levelFilter, securityFilter]);

  const activeTableTotalRows =
    activeTab === 'LB'
      ? lbRows.length
      : activeTab === 'ROSTER'
        ? rosterRows.length
        : activeTab === 'REG'
          ? filteredStandardTeams.length
          : levelAssertRows.length;

  const totalTablePages = Math.max(1, Math.ceil(activeTableTotalRows / ROWS_PER_PAGE));
  const safeTablePage = Math.min(Math.max(1, tablePage), totalTablePages);
  const tableStartIdx = (safeTablePage - 1) * ROWS_PER_PAGE;

  const pagedLbRows = useMemo(
    () => lbRows.slice(tableStartIdx, tableStartIdx + ROWS_PER_PAGE),
    [lbRows, tableStartIdx]
  );
  const pagedRosterRows = useMemo(
    () => rosterRows.slice(tableStartIdx, tableStartIdx + ROWS_PER_PAGE),
    [rosterRows, tableStartIdx]
  );
  const pagedRegTeams = useMemo(
    () => filteredStandardTeams.slice(tableStartIdx, tableStartIdx + ROWS_PER_PAGE),
    [filteredStandardTeams, tableStartIdx]
  );
  const pagedLevelAssertRows = useMemo(
    () => levelAssertRows.slice(tableStartIdx, tableStartIdx + ROWS_PER_PAGE),
    [levelAssertRows, tableStartIdx]
  );

  const handleAdminLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const candidateName = adminNameInput.trim();
    const candidatePass = passwordInput.trim();
    if (!candidateName || !candidatePass) {
      setAuthError('Enter both Admin Name and Password.');
      return;
    }
    setAuthBusy(true);
    setAuthError('');
    try {
      const ok = await verifyAdminCredentials(candidateName, candidatePass);
      if (!ok) {
        setAuthError('ACCESS DENIED: Invalid admin name or password.');
        setIsAdmin(false);
        return;
      }
      const nextSession = { name: candidateName.toUpperCase(), password: candidatePass };
      try {
        sessionStorage.setItem(STORAGE_KEYS.adminSessionKey, JSON.stringify(nextSession));
      } catch {
        // ignore
      }
      nextSinceRowRef.current = 2;
      lastPollEpochRef.current = 0;
      setAdminSession(nextSession);
      setAdminNameInput('');
      setPasswordInput('');
      setIsAdmin(true);
    } catch (err) {
      setAuthError(
        err instanceof Error ? err.message : 'Unable to verify admin credentials.'
      );
    } finally {
      setAuthBusy(false);
    }
  };

  const handleAdminLogout = () => {
    try {
      sessionStorage.removeItem(STORAGE_KEYS.adminSessionKey);
    } catch {
      // ignore
    }
    setAdminSession({ name: '', password: '' });
    setIsAdmin(false);
    setLiveLogs([]);
    setDisplayedLogs([]);
    nextSinceRowRef.current = 2;
    lastPollEpochRef.current = 0;
  };

  const toggleAutoRefresh = () => {
    setAutoRefresh((prev) => {
      const next = !prev;
      if (next) {
        setDisplayedLogs(liveLogs);
        setSystemStatusText('ONLINE');
        setSystemStatusClass('text-green-400');
      } else {
        setSystemStatusText('SYNC PAUSED');
        setSystemStatusClass('text-orange-400');
      }
      return next;
    });
  };

  const handleNewStart = () => {
    setConfirmMode('none');
    nextSinceRowRef.current = 2;
    setDisplayedLogs([]);
    setLiveLogs([]);
    setSystemStatusText('NEW START');
    setSystemStatusClass('text-amber-400 pulse-alert');
    window.setTimeout(() => {
      fetchAdminLogs(adminKey, 2)
        .then((res) => {
          lastPollEpochRef.current = res.epoch;
          nextSinceRowRef.current = Math.max(2, res.nextSinceRow);
          setLiveLogs(res.logs);
          setDisplayedLogs(res.logs);
          setSystemStatusText(autoRefresh ? 'ONLINE' : 'SYNC PAUSED');
          setSystemStatusClass(autoRefresh ? 'text-green-400' : 'text-orange-400');
        })
        .catch(() => {
          setSystemStatusText(autoRefresh ? 'ONLINE' : 'SYNC PAUSED');
          setSystemStatusClass(autoRefresh ? 'text-green-400' : 'text-orange-400');
        });
    }, 600);
  };

  const handleResetEverything = async () => {
    if (!adminKey) return;
    setResetting(true);
    setConfirmMode('none');
    setSystemStatusText('RESETTING...');
    setSystemStatusClass('text-red-400 pulse-alert');
    setLastUpdatedText('WIPING GOOGLE SHEET...');

    try {
      const nextEpoch = await adminResetAllData(adminKey);
      nextSinceRowRef.current = 2;
      lastPollEpochRef.current = nextEpoch;
      setDisplayedLogs([]);
      setLiveLogs([]);
      setSystemStatusText('RESET ✓');
      setSystemStatusClass('text-red-400 pulse-alert');
      setLastUpdatedText('ALL DATA WIPED - EPOCH BUMPED');
      window.setTimeout(() => {
        setSystemStatusText(autoRefresh ? 'ONLINE' : 'SYNC PAUSED');
        setSystemStatusClass(autoRefresh ? 'text-green-400' : 'text-orange-400');
      }, 3000);
    } catch (err) {
      console.error('Reset failed:', err);
      setSystemStatusText('RESET FAILED');
      setSystemStatusClass('text-red-400 pulse-alert');
      setLastUpdatedText('PERMISSION / NETWORK ERROR');
    } finally {
      setResetting(false);
    }
  };

  const handleExportCsv = () => {
    const headers = [
      'Timestamp',
      'Action',
      'Level',
      'TID',
      'TeamName',
      'Mission',
      'Language',
      'PuzzleID',
      'Status',
      'WrongAttempts',
      'TabSwitches',
      'HintUsed',
      'Points',
      'TotalScore',
    ];
    const escapeCsv = (val: unknown) => {
      const s = String(val ?? '');
      const neutralized = /^[\t\r\n ]*[=+\-@]/.test(s) ? `'${s}` : s;
      return `"${neutralized.replace(/"/g, '""')}"`;
    };
    const rows = displayedLogs.map((l) =>
      [
        l.timestamp,
        l.action,
        l.level,
        l.tid,
        l.teamName,
        l.mission,
        l.language,
        l.puzzleId,
        l.status,
        l.wrongAttempts,
        l.tabSwitches,
        l.hintUsed ? '1' : '0',
        l.points,
        l.totalScore,
      ]
        .map(escapeCsv)
        .join(',')
    );
    const csv = [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `pykachu-go-telemetry-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const headerStyle = {
    gridTemplateColumns:
      activeTab === 'REG'
        ? REG_COLS
        : activeTab === 'LB'
          ? LB_COLS
          : activeTab === 'ROSTER'
            ? ROSTER_COLS
            : L_COLS,
  };

  return (
    <div className="admin-viewport">
      {/* Admin JSON Auth Gate */}
      {!isAdmin && (
        <div
          id="adminAuthModal"
          className="fixed inset-0 z-50 grid min-h-[100dvh] place-items-start overflow-y-auto bg-slate-950/95 px-4 py-[max(1rem,env(safe-area-inset-top))] sm:place-items-center sm:p-6"
        >
          <form
            onSubmit={handleAdminLoginSubmit}
            className="my-auto w-full max-w-sm max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-xl border border-slate-700 bg-slate-900 p-5 shadow-2xl sm:p-6"
          >
            <h1 className="font-mono text-lg font-bold text-slate-100">ADMIN ACCESS</h1>
            <p className="mt-2 text-sm text-slate-400">
              Sign in with your organizer Name &amp; Password configured in{' '}
              <span className="text-indigo-300 font-mono">data/admin.json</span>.
            </p>
            <p className="mt-1 text-[10px] text-slate-500 font-mono tracking-wide">
              JSON-LEVEL FAST AUTH • OPTIONAL APPS SCRIPT SYNC
            </p>

            <div className="mt-4 space-y-3">
              <div>
                <label className="block text-[10px] font-mono uppercase tracking-wider text-slate-400 mb-1.5">
                  Admin Name
                </label>
                <input
                  type="text"
                  id="adminNameInput"
                  value={adminNameInput}
                  onChange={(e) => setAdminNameInput(e.target.value)}
                  placeholder="ADMIN"
                  autoComplete="username"
                  autoCapitalize="characters"
                  disabled={authChecking || authBusy}
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5 font-mono text-sm text-white uppercase placeholder-slate-600 focus:border-indigo-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-[10px] font-mono uppercase tracking-wider text-slate-400 mb-1.5">
                  Password
                </label>
                <input
                  type="password"
                  id="adminPasswordInput"
                  value={passwordInput}
                  onChange={(e) => setPasswordInput(e.target.value)}
                  placeholder="••••••••"
                  autoComplete="current-password"
                  disabled={authChecking || authBusy}
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5 font-mono text-sm text-white placeholder-slate-600 focus:border-indigo-500 focus:outline-none"
                />
              </div>
            </div>

            {authError && (
              <p id="adminAuthError" className="mt-3 text-xs text-red-400 font-mono">
                {authError}
              </p>
            )}

            <button
              type="submit"
              disabled={authChecking || authBusy}
              className="mt-5 w-full rounded-lg bg-indigo-600 px-4 py-3 font-mono text-sm font-bold text-white hover:bg-indigo-500 disabled:opacity-60"
            >
              {authChecking
                ? 'CHECKING SESSION...'
                : authBusy
                  ? 'VERIFYING...'
                  : 'UNLOCK COMMAND NODE'}
            </button>

            <a
              href="/"
              className="mt-3 block text-center font-mono text-xs text-slate-400 hover:text-indigo-300"
            >
              ← Return to Pokédex Terminal
            </a>
          </form>
        </div>
      )}

      {/* Confirmation Modals (replaces native confirm()) */}
      {confirmMode !== 'none' && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/90 p-4 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-xl border border-slate-700 bg-slate-900 p-5 shadow-2xl">
            <h3 className="font-mono text-base font-bold text-slate-100">
              {confirmMode === 'new_start'
                ? 'NEW ADMIN SESSION'
                : confirmMode === 'reset_1'
                  ? 'RESET EVERYTHING?'
                  : 'FINAL CONFIRMATION'}
            </h3>
            <p className="mt-2 text-xs leading-relaxed text-slate-300 font-mono">
              {confirmMode === 'new_start'
                ? 'Start a new admin session? This refreshes the live telemetry feed.'
                : confirmMode === 'reset_1'
                  ? 'RESET EVERYTHING? This wipes ALL player telemetry logs and progress from Google Sheets (Registration + L1/L2/L3).'
                  : 'Are you ABSOLUTELY sure? Every player’s saved progress (queue, score, hints) will be erased on their next load. This CANNOT be undone.'}
            </p>
            <div className="mt-5 flex gap-2">
              <button
                type="button"
                disabled={resetting}
                onClick={() => {
                  if (confirmMode === 'new_start') handleNewStart();
                  else if (confirmMode === 'reset_1') setConfirmMode('reset_2');
                  else void handleResetEverything();
                }}
                className={`flex-1 rounded-lg px-3 py-2.5 font-mono text-xs font-bold text-white ${
                  confirmMode === 'new_start'
                    ? 'bg-amber-600 hover:bg-amber-500'
                    : 'bg-red-600 hover:bg-red-500'
                }`}
              >
                {confirmMode === 'new_start'
                  ? 'REFRESH'
                  : confirmMode === 'reset_1'
                    ? 'CONTINUE'
                    : 'WIPE ALL DATA'}
              </button>
              <button
                type="button"
                disabled={resetting}
                onClick={() => setConfirmMode('none')}
                className="flex-1 rounded-lg bg-slate-800 px-3 py-2.5 font-mono text-xs font-bold text-slate-300 hover:bg-slate-700"
              >
                CANCEL
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="cyber-grid"></div>

      <header
        className="glass-panel sticky top-0 z-40 border-b border-indigo-500/20"
        style={{ paddingTop: 'var(--safe-top)' }}
      >
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between container-padding">
          <div className="flex items-center gap-3">
            <div className="relative">
              <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse absolute -top-1 -right-1"></div>
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="w-6 h-6 sm:w-7 sm:h-7 md:w-8 md:h-8 text-indigo-400"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
              </svg>
            </div>
            <div>
              <h1 className="font-pixel text-responsive bg-gradient-to-r from-indigo-400 to-cyan-400 bg-clip-text text-transparent">
                Pykachu<span className="text-white">Go</span>
              </h1>
              <p className="text-[10px] text-slate-500 font-mono tracking-widest uppercase hidden sm:block">
                Admin Command Node
              </p>
              <p className="text-[8px] text-slate-500 font-mono tracking-widest uppercase sm:hidden">
                ADMIN
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={toggleAutoRefresh}
              className={`sync-btn group relative px-3 py-2 ${
                autoRefresh
                  ? 'bg-indigo-600 hover:bg-indigo-500'
                  : 'bg-slate-700 hover:bg-slate-600'
              } transition-all rounded-lg overflow-hidden flex items-center gap-2 shadow-lg shadow-indigo-500/20 active:scale-95`}
            >
              <div className="absolute inset-0 bg-white/20 group-hover:translate-x-full duration-500 transform -skew-x-12 -translate-x-full"></div>
              <div className="flex items-center gap-2">
                <svg className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                  />
                </svg>
                <span className="text-xs font-bold text-white tracking-wider">SYNC</span>
              </div>
            </button>

            <button
              type="button"
              onClick={() => setConfirmMode('new_start')}
              className="reset-btn relative px-3 py-2 bg-amber-500 hover:bg-amber-400 transition-all rounded-lg flex items-center gap-2 text-white font-semibold shadow-lg shadow-amber-500/20 active:scale-95"
              title="Start new admin session"
            >
              <svg className="w-3.5 h-3.5 sm:w-4 sm:h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  d="M4 4v6h6M20 20v-6h-6M7 17a7 7 0 1110-10m-2 2l3-3m0 0l-3 3m3-3h-3"
                />
              </svg>
              <span className="text-xs tracking-wider hidden sm:inline">NEW START</span>
            </button>

            <button
              type="button"
              disabled={resetting}
              onClick={() => setConfirmMode('reset_1')}
              className="relative px-3 py-2 bg-red-600 hover:bg-red-500 transition-all rounded-lg flex items-center gap-2 text-white font-bold shadow-lg shadow-red-500/20 active:scale-95 border border-red-400/40 disabled:opacity-50"
              title="Wipe Google Sheet telemetry + all players' saved progress (new game run)"
            >
              <svg className="w-3.5 h-3.5 sm:w-4 sm:h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                />
              </svg>
              <span className="text-xs tracking-wider">RESET ALL</span>
            </button>

            <button
              type="button"
              onClick={handleAdminLogout}
              className="relative px-2.5 py-2 bg-slate-800 hover:bg-slate-700 transition-all rounded-lg text-slate-300 font-mono text-xs font-bold border border-slate-700"
              title="Lock Admin Command Node"
            >
              LOCK
            </button>
          </div>
        </div>
      </header>

      <main className="relative z-10 flex-1 max-w-7xl mx-auto w-full p-3 sm:p-4 lg:p-8 grid grid-cols-1 lg:grid-cols-12 gap-4 sm:gap-6 container-padding">
        <aside className="lg:col-span-3 space-y-4">
          <div className="glass-panel p-4 sm:p-5 rounded-xl border-l-4 border-indigo-500">
            <div className="flex justify-between items-start mb-2">
              <div className="p-2 bg-indigo-500/10 rounded-lg">
                <svg className="w-4 h-4 sm:w-5 sm:h-5 text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"
                  />
                </svg>
              </div>
              <span className="text-xs text-slate-500 font-mono">LIVE</span>
            </div>
            <h3 className="text-slate-400 text-xs font-bold uppercase tracking-wider">
              Active Teams
            </h3>
            <p id="teamCount" className="text-2xl sm:text-3xl font-bold text-white mt-1 font-mono">
              {activeTeamCount}
            </p>
          </div>

          <div className="glass-panel p-4 sm:p-5 rounded-xl border-l-4 border-emerald-500">
            <div className="flex justify-between items-start mb-2">
              <div className="p-2 bg-emerald-500/10 rounded-lg">
                <svg className="w-4 h-4 sm:w-5 sm:h-5 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
              </div>
              <span className="text-xs text-slate-500 font-mono">TOTAL</span>
            </div>
            <h3 className="text-slate-400 text-xs font-bold uppercase tracking-wider">
              Decryptions
            </h3>
            <p id="badgeCount" className="text-2xl sm:text-3xl font-bold text-white mt-1 font-mono">
              {totalSolved}
            </p>
          </div>

          <div className="glass-panel p-4 sm:p-5 rounded-xl">
            <h3 className="text-indigo-400 text-xs font-bold uppercase tracking-wider mb-4 flex items-center gap-2">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z"
                />
              </svg>
              Mission Filters
            </h3>

            <div className="space-y-4">
              <div className="relative">
                <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-slate-500">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2"
                      d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                    />
                  </svg>
                </span>
                <input
                  type="text"
                  id="teamSearch"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="Search team..."
                  className="w-full bg-slate-900/50 border border-slate-700 text-slate-200 text-xs rounded-lg pl-9 pr-3 py-3 sm:py-2.5 focus:outline-none focus:border-indigo-500 transition-colors"
                />
              </div>

              <div>
                <label className="text-[10px] text-slate-500 font-bold uppercase mb-2 block">
                  Specialty Type
                </label>
                <CustomSelect
                  id="typeFilter"
                  value={typeFilter}
                  onChange={setTypeFilter}
                  options={typeSelectOptions}
                  placeholder="ALL TYPES"
                />
              </div>

              <div>
                <label className="text-[10px] text-slate-500 font-bold uppercase mb-2 block">
                  Level Filter
                </label>
                <CustomSelect
                  id="levelFilter"
                  value={levelFilter}
                  onChange={setLevelFilter}
                  options={levelSelectOptions}
                  placeholder="ALL LEVELS"
                />
              </div>

              <div className="grid grid-cols-1 gap-2">
                <button
                  type="button"
                  id="filterAll"
                  onClick={() => setSecurityFilter('ALL')}
                  className={`security-filter-btn w-full text-left px-3 py-3 sm:py-2 rounded-lg text-xs font-medium transition-all flex justify-between items-center ${
                    securityFilter === 'ALL'
                      ? 'bg-indigo-600 text-white group'
                      : 'text-slate-400 hover:bg-slate-800 bg-transparent border border-slate-700/50'
                  }`}
                >
                  <span>Show All Activity</span>
                  <span className="material-symbols-rounded text-sm sm:text-base">analytics</span>
                </button>
                <button
                  type="button"
                  id="filterHint"
                  onClick={() => setSecurityFilter('HINT')}
                  className={`security-filter-btn w-full text-left px-3 py-3 sm:py-2 rounded-lg text-xs font-medium transition-all flex justify-between items-center ${
                    securityFilter === 'HINT'
                      ? 'bg-indigo-600 text-white'
                      : 'text-slate-400 hover:bg-slate-800 bg-transparent border border-slate-700/50'
                  }`}
                >
                  <span>Hint Used</span>
                  <span className="material-symbols-rounded text-sm sm:text-base text-yellow-400">lightbulb</span>
                </button>
                <button
                  type="button"
                  id="filterMalpractice"
                  onClick={() => setSecurityFilter('MALPRACTICE')}
                  className={`security-filter-btn w-full text-left px-3 py-3 sm:py-2 rounded-lg text-xs font-medium transition-all flex justify-between items-center ${
                    securityFilter === 'MALPRACTICE'
                      ? 'bg-indigo-600 text-white'
                      : 'text-slate-400 hover:bg-slate-800 bg-transparent border border-slate-700/50'
                  }`}
                >
                  <span>Tab Switches</span>
                  <span className="material-symbols-rounded text-sm sm:text-base text-red-400">warning</span>
                </button>
              </div>
            </div>

            <div className="mt-6 pt-6 border-t border-slate-800">
              <button
                type="button"
                onClick={handleExportCsv}
                className="flex items-center justify-center gap-2 w-full py-3 sm:py-2 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 text-xs font-bold rounded-lg border border-emerald-500/20 transition-all"
              >
                <span className="material-symbols-rounded text-base sm:text-lg">download</span>
                <span>EXPORT TELEMETRY CSV</span>
              </button>
            </div>
          </div>
        </aside>

        <div className="lg:col-span-9 flex flex-col h-full min-h-[400px] sm:min-h-[500px]">
          <div className="flex gap-2 mb-4 overflow-x-auto pb-2 scrollbar-hide">
            {(['REG', 'L1', 'L2', 'L3', 'LB', 'ROSTER', 'CREATE'] as AdminTab[]).map((tab) => {
              const labelMap: Record<AdminTab, string> = {
                REG: 'REGISTRATION',
                L1: 'LEVEL 1',
                L2: 'LEVEL 2',
                L3: 'LEVEL 3',
                LB: 'LEADERBOARD',
                ROSTER: 'ROSTER LOG',
                CREATE: 'CREATE & BULK',
              };
              return (
                <button
                  key={tab}
                  type="button"
                  id={`tab-${tab}`}
                  onClick={() => setActiveTab(tab)}
                  className={`tab-btn ${
                    activeTab === tab ? 'active ' : ''
                  }px-4 py-2 rounded-lg text-xs font-bold transition-all whitespace-nowrap`}
                >
                  {labelMap[tab]}
                </button>
              );
            })}
          </div>

          <div className="glass-panel flex-1 rounded-xl overflow-hidden flex flex-col">
            <div className="px-4 sm:px-6 py-3 sm:py-4 border-b border-slate-800 flex justify-between items-center bg-slate-900/40">
              <h2 className="text-sm font-bold text-white flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse"></span>
                <span className="hidden sm:inline">
                  {activeTab === 'CREATE' ? 'CREATOR STUDIO & EXCEL BULK IMPORTER' : 'TEAM STATUS MONITOR'}
                </span>
                <span className="sm:hidden">
                  {activeTab === 'CREATE' ? 'CREATOR STUDIO' : 'MONITOR'}
                </span>
                <span
                  id="dataSourceIndicator"
                  className={`text-[10px] font-mono ml-2 ${
                    hasLiveData ? 'text-emerald-500' : 'text-amber-500 pulse-alert'
                  }`}
                >
                  {hasLiveData ? '[LIVE]' : '[SYNCING]'}
                </span>
              </h2>
              <span className="text-[10px] text-slate-500 font-mono truncate pl-2" id="lastUpdated">
                {lastUpdatedText}
              </span>
              <span id="systemStatus" className={`text-[10px] font-mono ml-2 ${systemStatusClass}`}>
                {systemStatusText}
              </span>
            </div>

            {activeTab === 'CREATE' ? (
              <AdminCreatorPanel
                adminKey={adminKey}
                teams={teams}
                memes={memes}
                puzzles={puzzles}
                onCatalogUpdated={reloadCatalog}
              />
            ) : (
            <div className="flex-1 overflow-x-auto flex flex-col min-w-0">
              <div className="min-w-[680px] flex flex-col flex-1">
                <div
                  className={`grid gap-1 px-3 py-2.5 bg-slate-950/90 border-b border-slate-800 ${
                    activeTab === 'REG' || activeTab === 'LB' || activeTab === 'ROSTER'
                      ? 'text-[9px]'
                      : 'text-[8px]'
                  } font-bold text-slate-400 uppercase tracking-widest font-mono text-center`}
                  style={headerStyle}
                >
                  {activeTab === 'REG' ? (
                    <>
                      <div className="text-center font-mono">#</div>
                      <div className="text-center font-mono text-emerald-400">Registration Time</div>
                      <div className="text-center font-mono text-blue-400">TID</div>
                      <div className="text-left font-bold pl-1">Team Name</div>
                      <div className="text-center font-mono text-cyan-400">Language</div>
                      <div className="text-center font-mono text-indigo-400">Mission</div>
                    </>
                  ) : activeTab === 'LB' ? (
                    <>
                      <div className="text-center font-mono">#</div>
                      <div className="text-center font-mono text-blue-400">TID</div>
                      <div className="text-left font-bold pl-1">Team Name</div>
                      <div className="text-center font-mono text-slate-400">Timestamp</div>
                      <div className="text-center font-mono text-slate-400">Solved</div>
                      <div className="text-center font-mono text-amber-400">Hints</div>
                      <div className="text-center font-mono text-pink-400">Tabs</div>
                      <div className="text-center font-mono text-emerald-300">Total Pts</div>
                    </>
                  ) : activeTab === 'ROSTER' ? (
                    <>
                      <div className="text-center font-mono">#</div>
                      <div className="text-left font-bold pl-1">Team Name</div>
                      <div className="text-center font-mono text-blue-400">TID</div>
                      <div className="text-center font-mono text-slate-400">Security Key</div>
                      <div className="text-left font-mono text-emerald-300">Team Members</div>
                    </>
                  ) : (
                    <>
                      <div className="text-center font-mono">#</div>
                      <div className="text-center font-mono text-slate-400">TID</div>
                      <div className="text-left font-bold pl-1">Team Name</div>
                      <div className="text-center font-mono text-indigo-400">Mission</div>
                      <div className="text-center font-mono text-cyan-400">Puzzle</div>
                      <div className="text-center font-mono text-red-400">Wrong</div>
                      <div className="text-center font-mono text-pink-400">Tabs</div>
                      <div className="text-center font-mono text-amber-400">Hint</div>
                      <div className="text-center font-mono text-emerald-400">Timestamp</div>
                      <div className="text-center font-mono">Status</div>
                      <div className="text-center font-mono text-slate-400">Points</div>
                      <div className="text-center font-mono text-amber-300">Score</div>
                      <div className="text-center font-mono text-purple-400">Unlocked</div>
                    </>
                  )}
                </div>

                <div
                  id="logsContainer"
                  className="flex-1 overflow-y-auto divide-y divide-slate-800/50 bg-slate-900/20 font-mono text-xs"
                >
                  {activeTab === 'LB' ? (
                    lbRows.length === 0 ? (
                      <EmptyTabNotice />
                    ) : (
                      pagedLbRows.map((r, i) => {
                        const rank = tableStartIdx + i + 1;
                        const medal =
                          rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : rank;
                        return (
                          <div
                            key={`${r.tid}-${r.name}`}
                            className="grid gap-1 px-3 py-2.5 border-b border-slate-800/50 hover:bg-white/5 transition-all items-center text-[10px] sm:text-xs text-center fade-in"
                            style={{ gridTemplateColumns: LB_COLS }}
                          >
                            <div className="text-slate-500 font-mono">{medal}</div>
                            <div className="font-mono text-blue-400 font-bold truncate">{r.tid}</div>
                            <div
                              className="text-left font-bold text-slate-200 uppercase tracking-tight truncate pl-1"
                              title={r.name}
                            >
                              {r.name}
                            </div>
                            <div className="text-slate-400 font-mono text-[10px]">
                              {formatTime(r.timestamp)}
                            </div>
                            <div className="font-mono text-slate-300">{r.solved}</div>
                            <div className="font-mono text-amber-300">{r.totalHints}</div>
                            <div className="font-mono text-pink-300">{r.totalTabs}</div>
                            <div
                              className={`font-mono font-bold ${
                                r.solved > 0 && r.pts > 0 ? 'text-emerald-300' : 'text-slate-500'
                              }`}
                            >
                              {r.solved > 0 ? r.pts : '-'}
                            </div>
                          </div>
                        );
                      })
                    )
                  ) : activeTab === 'ROSTER' ? (
                    rosterRows.length === 0 ? (
                      <EmptyTabNotice label="NO ROSTER DATA AVAILABLE" />
                    ) : (
                      pagedRosterRows.map((t, i) => {
                        const members =
                          Array.isArray(t.team_members) && t.team_members.length
                            ? t.team_members.join(' | ')
                            : '-';
                        return (
                          <div
                            key={`${t.tid}-${t.team}`}
                            className="grid gap-1 px-3 py-2.5 border-b border-slate-800/50 hover:bg-white/5 transition-all items-center text-[10px] sm:text-xs text-center fade-in"
                            style={{ gridTemplateColumns: ROSTER_COLS }}
                          >
                            <div className="text-slate-500 font-mono">{tableStartIdx + i + 1}</div>
                            <div
                              className="text-left font-bold text-slate-200 truncate pl-1"
                              title={t.team}
                            >
                              {t.team}
                            </div>
                            <div className="font-mono text-blue-400 truncate" title={t.tid || ''}>
                              {t.tid || '-'}
                            </div>
                            <div
                              className="font-mono text-slate-400 truncate"
                              title={t.securityKey || ''}
                            >
                              {t.securityKey || '-'}
                            </div>
                            <div
                              className="text-left font-mono text-emerald-300 truncate pl-1"
                              title={members}
                            >
                              {members}
                            </div>
                          </div>
                        );
                      })
                    )
                  ) : activeTab === 'REG' ? (
                    filteredStandardTeams.length === 0 ? (
                      <EmptyTabNotice />
                    ) : (
                      pagedRegTeams.map((team, index) => (
                        <div
                          key={`${team.tid}-${team.name}`}
                          className="grid gap-1 px-3 py-2.5 border-b border-slate-800/50 hover:bg-white/5 transition-all items-center text-[10px] sm:text-xs text-center fade-in"
                          style={{ gridTemplateColumns: REG_COLS }}
                        >
                          <div className="text-slate-500 font-mono">{tableStartIdx + index + 1}</div>
                          <div className="text-emerald-400 font-mono text-[10px]">
                            {formatTime(team.regTime)}
                          </div>
                          <div className="font-mono text-blue-400 font-bold truncate">
                            {team.tid || '-'}
                          </div>
                          <div
                            className="text-left font-bold text-slate-200 uppercase tracking-tight truncate pl-1"
                            title={team.name}
                          >
                            {team.name}
                          </div>
                          <div className="text-cyan-400 font-mono font-bold text-[10px]">
                            {team.language || 'PYTHON'}
                          </div>
                          <div>
                            <span className="bg-indigo-500/10 text-indigo-400 px-2 py-0.5 rounded border border-indigo-500/20 font-bold text-[10px]">
                              {team.mission}
                            </span>
                          </div>
                        </div>
                      ))
                    )
                  ) : levelAssertRows.length === 0 ? (
                    <EmptyTabNotice />
                  ) : (
                    pagedLevelAssertRows.map(({ team, record }, index) => {
                      const globalIndex = tableStartIdx + index;
                      const lvlData: LevelRecord = record || {
                        lastActive: '',
                        tid: team.tid || '-',
                        teamName: team.name,
                        mission: team.mission,
                        puzzleId: 0,
                        status: 'IDLE',
                        wrongAttempts: 0,
                        tabSwitches: 0,
                        hintUsed: false,
                        timestamp: '',
                        pointsEarned: 0,
                        pointsLost: 0,
                        hasPointData: false,
                        totalScore: 0,
                        unlockedPuzzles: '',
                      };

                      const timestampStr = formatTime(lvlData.timestamp);
                      const recordStatus = String(lvlData.status || '').trim().toUpperCase();
                      const isRepeatSolve = recordStatus === 'REPEAT_SOLVE';
                      const isSolved = recordStatus === 'SOLVED' || isRepeatSolve;
                      const netPts = isSolved ? Number(lvlData.points || 0) : null;
                      const lid = puzzleLinkById[lvlData.puzzleId];

                      return (
                        <div
                          key={`${team.tid}-${team.name}-${lvlData.puzzleId}-${globalIndex}`}
                          className="grid gap-1 px-3 py-2 border-b border-slate-800/50 transition-all items-center hover:bg-white/5 text-[9px] text-center fade-in"
                          style={{ gridTemplateColumns: L_COLS }}
                        >
                          <div className="text-slate-500 font-mono">{globalIndex + 1}</div>
                          <div className="font-mono text-slate-400 truncate">
                            {lvlData.tid || '-'}
                          </div>
                          <div
                            className="text-left font-bold text-slate-200 truncate pl-1"
                            title={team.name}
                          >
                            {team.name}
                          </div>
                          <div className="font-mono text-indigo-400 truncate text-[9px]">
                            {lvlData.mission || team.mission}
                          </div>
                          <div className="font-mono text-cyan-400 font-bold text-[8px]">
                            {lvlData.puzzleId && lid ? (
                              <a
                                href={`/?linkid=${encodeURIComponent(lid)}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="hover:text-cyan-200 hover:underline underline-offset-2 transition-colors"
                                title={`Puzzle ${lvlData.puzzleId} — open deep link (linkid ${lid})`}
                              >
                                P{lvlData.puzzleId}
                              </a>
                            ) : lvlData.puzzleId ? (
                              `P${lvlData.puzzleId}`
                            ) : (
                              '-'
                            )}
                          </div>
                          <div
                            className={`font-bold font-mono ${
                              lvlData.wrongAttempts > 0 ? 'text-red-400' : 'text-slate-600'
                            }`}
                          >
                            {lvlData.wrongAttempts}
                          </div>
                          <div
                            className={`font-bold font-mono ${
                              lvlData.tabSwitches > 0 ? 'text-pink-400' : 'text-slate-600'
                            }`}
                          >
                            {lvlData.tabSwitches}
                          </div>
                          <div className="font-bold">
                            {lvlData.hintUsed ? (
                              <span className="text-yellow-400 font-bold">1</span>
                            ) : (
                              <span className="text-slate-600">0</span>
                            )}
                          </div>
                          <div className="font-mono text-emerald-400 text-[8px]">
                            {timestampStr}
                          </div>
                          <div className="font-bold">
                            {isRepeatSolve ? (
                              <span
                                className="text-amber-300 font-bold"
                                title="Solved again; points deducted"
                              >
                                REPEAT SOLVE
                              </span>
                            ) : isSolved ? (
                              <span className="text-emerald-400 font-bold">SOLVED</span>
                            ) : (
                              <span className="text-red-400 font-bold">UNSOLVED</span>
                            )}
                          </div>
                          <div
                            className={`font-mono text-[8px] font-bold ${
                              isSolved && netPts !== null
                                ? netPts > 0
                                  ? 'text-emerald-300'
                                  : netPts < 0
                                    ? 'text-red-300'
                                    : 'text-slate-500'
                                : 'text-slate-600'
                            }`}
                          >
                            {isSolved && netPts !== null ? netPts : '-'}
                          </div>
                          <div className="font-mono text-amber-300 font-bold text-[8px]">
                            {lvlData.totalScore || 0}
                          </div>
                          <div
                            className="font-mono text-purple-400 truncate text-[8px]"
                            title="Unlock queue after this puzzle"
                          >
                            {lvlData.unlockedPuzzles || '-'}
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            </div>
            )}

            <div className="px-3 py-2 bg-slate-950/50 border-t border-slate-800 text-[9px] sm:text-[10px] text-slate-400 flex flex-wrap items-center justify-between gap-2 font-mono">
              <span className="truncate text-slate-500">
                SECURE: TLS_1.3 • v3.4.0 DB-FIRST
              </span>
              {activeTab !== 'CREATE' && totalTablePages > 1 && (
                <div className="flex items-center gap-2">
                  <span>
                    {tableStartIdx + 1}–{Math.min(tableStartIdx + ROWS_PER_PAGE, activeTableTotalRows)} / {activeTableTotalRows}
                  </span>
                  <button
                    type="button"
                    disabled={safeTablePage <= 1}
                    onClick={() => setTablePage((p) => Math.max(1, p - 1))}
                    className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-slate-200"
                  >
                    PREV
                  </button>
                  <span className="text-indigo-300 font-bold">
                    {safeTablePage}/{totalTablePages}
                  </span>
                  <button
                    type="button"
                    disabled={safeTablePage >= totalTablePages}
                    onClick={() => setTablePage((p) => Math.min(totalTablePages, p + 1))}
                    className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-slate-200"
                  >
                    NEXT
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
};

const EmptyTabNotice: React.FC<{ label?: string }> = ({
  label = 'NO DATA AVAILABLE FOR THIS TAB',
}) => (
  <div className="flex flex-col items-center justify-center h-full text-slate-600 opacity-50 fade-in py-12">
    <svg className="w-10 h-10 sm:w-12 sm:h-12 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
        d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
      />
    </svg>
    <span className="font-mono text-xs">{label}</span>
  </div>
);
