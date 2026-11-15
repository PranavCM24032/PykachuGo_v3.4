import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Database,
  Download,
  ExternalLink,
  FileSpreadsheet,
  Film,
  Plus,
  Puzzle as PuzzleIcon,
  Search,
  Trash2,
  Upload,
  Users,
  XCircle,
} from 'lucide-react';
import {
  adminDeleteMemeCatalog,
  adminDeletePuzzleCatalog,
  adminDeleteTeamCatalog,
  adminUpsertMemes,
  adminUpsertPuzzles,
  adminUpsertTeams,
  sanitizeCatalogId,
} from '../services/gameBackend';
import {
  downloadMemesTemplateXlsx,
  downloadPuzzlesTemplateXlsx,
  downloadTeamsTemplateXlsx,
  exportMemesToXlsx,
  exportPuzzlesToXlsx,
  exportTeamsToXlsx,
  parseMemesSpreadsheet,
  parsePuzzlesSpreadsheet,
  parseTeamsSpreadsheet,
  type ParsedSpreadsheetResult,
} from '../utils/excelCatalog';
import type { MemeEntry, Puzzle, TeamEntry } from '../types/game';

type CreatorMode = 'TEAM' | 'MEME' | 'PUZZLE';

interface AdminCreatorPanelProps {
  adminKey: string;
  teams: TeamEntry[];
  memes: MemeEntry[];
  puzzles: Puzzle[];
  onCatalogUpdated: () => Promise<void>;
}

function suggestNextTid(teams: TeamEntry[]): string {
  let maxNum = 0;
  teams.forEach((t) => {
    const m = String(t.tid || '').match(/\d+/);
    if (m) {
      const n = Number(m[0]);
      if (!Number.isNaN(n) && n > maxNum) maxNum = n;
    }
  });
  return `T${String(maxNum + 1).padStart(3, '0')}`;
}

function suggestNextMemeId(memes: MemeEntry[]): string {
  let maxNum = 0;
  memes.forEach((m) => {
    const match = String(m.memeid || '').match(/\d+/);
    if (match) {
      const n = Number(match[0]);
      if (!Number.isNaN(n) && n > maxNum) maxNum = n;
    }
  });
  return `M${String(maxNum + 1).padStart(2, '0')}`;
}

function suggestNextPuzzleId(puzzles: Puzzle[]): number {
  let maxId = 0;
  puzzles.forEach((p) => {
    if (Number(p.id) > maxId) maxId = Number(p.id);
  });
  return maxId + 1;
}

export const AdminCreatorPanel: React.FC<AdminCreatorPanelProps> = ({
  adminKey,
  teams,
  memes,
  puzzles,
  onCatalogUpdated,
}) => {
  const [mode, setMode] = useState<CreatorMode>('TEAM');
  const [catalogSearch, setCatalogSearch] = useState('');
  const [catalogPage, setCatalogPage] = useState(1);
  const [busy, setBusy] = useState(false);
  const [statusBanner, setStatusBanner] = useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);
  const [confirmDeleteKey, setConfirmDeleteKey] = useState<string | null>(null);

  // Team Form State
  const [teamTid, setTeamTid] = useState(() => suggestNextTid(teams));
  const [teamName, setTeamName] = useState('');
  const [teamKey, setTeamKey] = useState('123');
  const [teamMembersText, setTeamMembersText] = useState('');

  // Meme Form State
  const [memeId, setMemeId] = useState(() => suggestNextMemeId(memes));
  const [memeYtLink, setMemeYtLink] = useState('');
  const [memeStart, setMemeStart] = useState('0');
  const [memeEnd, setMemeEnd] = useState('0');

  // Puzzle Form State
  const nextPid = useMemo(() => suggestNextPuzzleId(puzzles), [puzzles]);
  const [puzzleId, setPuzzleId] = useState(() => String(nextPid));
  const [puzzleLinkId, setPuzzleLinkId] = useState(() => `XG${String(nextPid).padStart(2, '0')}`);
  const [puzzleLevel, setPuzzleLevel] = useState('1');
  const [puzzlePoints, setPuzzlePoints] = useState('10');
  const [puzzleStartCode, setPuzzleStartCode] = useState('');
  const [puzzleBadgeId, setPuzzleBadgeId] = useState('0');
  const [puzzleLocation, setPuzzleLocation] = useState('');
  const [puzzlePokemonId, setPuzzlePokemonId] = useState('25');
  const [puzzlePokemonName, setPuzzlePokemonName] = useState('Pikachu');
  const [puzzleAnswer, setPuzzleAnswer] = useState('');
  const [puzzleHint, setPuzzleHint] = useState('');
  const [puzzleHintPenalty, setPuzzleHintPenalty] = useState('60');
  const [puzzleNextIds, setPuzzleNextIds] = useState('');
  const [puzzlePython, setPuzzlePython] = useState('');
  const [puzzleCpp, setPuzzleCpp] = useState('');

  // Excel Bulk Upload State
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [bulkFilename, setBulkFilename] = useState('');
  const [bulkTeams, setBulkTeams] = useState<ParsedSpreadsheetResult<TeamEntry> | null>(null);
  const [bulkMemes, setBulkMemes] = useState<ParsedSpreadsheetResult<MemeEntry> | null>(null);
  const [bulkPuzzles, setBulkPuzzles] = useState<ParsedSpreadsheetResult<Puzzle> | null>(null);

  // Keep auto-suggested IDs fresh when empty or unchanged on catalog change
  useEffect(() => {
    if (!teamName) setTeamTid(suggestNextTid(teams));
  }, [teams, teamName]);

  useEffect(() => {
    if (!memeYtLink) setMemeId(suggestNextMemeId(memes));
  }, [memes, memeYtLink]);

  useEffect(() => {
    if (!puzzleAnswer && !puzzlePython && !puzzleCpp) {
      const n = suggestNextPuzzleId(puzzles);
      setPuzzleId(String(n));
      setPuzzleLinkId(`XG${String(n).padStart(2, '0')}`);
    }
  }, [puzzles, puzzleAnswer, puzzlePython, puzzleCpp]);

  const clearBulkPreview = () => {
    setBulkFilename('');
    setBulkTeams(null);
    setBulkMemes(null);
    setBulkPuzzles(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleModeSwitch = (next: CreatorMode) => {
    setMode(next);
    setCatalogSearch('');
    setCatalogPage(1);
    setConfirmDeleteKey(null);
    setStatusBanner(null);
    clearBulkPreview();
  };

  const handleExportJson = () => {
    let payload: unknown = [];
    let filename = 'data.json';
    if (mode === 'TEAM') {
      payload = teams.map(({ isCustom: _c, ...rest }) => rest);
      filename = 'teams.json';
    } else if (mode === 'MEME') {
      payload = memes.map(({ isCustom: _c, ...rest }) => rest);
      filename = 'meme.json';
    } else {
      payload = puzzles.map(({ isCustom: _c, ...rest }) => rest);
      filename = 'puzzle.json';
    }
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: 'application/json;charset=utf-8;',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // Single Save Handlers
  const handleCreateTeam = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatusBanner(null);
    const cleanTid = sanitizeCatalogId(teamTid.toUpperCase(), 32);
    const cleanName = teamName.trim();
    const cleanKey = teamKey.trim();

    if (!cleanTid || !cleanName || !cleanKey) {
      setStatusBanner({
        type: 'error',
        message: 'TID, Team Name, and Security Key are required.',
      });
      return;
    }
    const members = teamMembersText
      .split(/[,|\n]+/)
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 12);

    setBusy(true);
    try {
      await adminUpsertTeams(
        [{ tid: cleanTid, team: cleanName, securityKey: cleanKey, team_members: members }],
        adminKey
      );
      await onCatalogUpdated();
      setTeamName('');
      setTeamMembersText('');
      setStatusBanner({
        type: 'success',
        message: `Saved team "${cleanName}" (${cleanTid}) to Google Sheet.`,
      });
    } catch (err) {
      setStatusBanner({
        type: 'error',
        message: err instanceof Error ? err.message : 'Failed to save team.',
      });
    } finally {
      setBusy(false);
    }
  };

  const handleCreateMeme = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatusBanner(null);
    const cleanId = sanitizeCatalogId(memeId.toUpperCase(), 32);
    const cleanLink = memeYtLink.trim();
    const start = Math.max(0, Number(memeStart || 0));
    const end = Math.max(0, Number(memeEnd || 0));

    if (!cleanId || cleanLink.length < 5) {
      setStatusBanner({
        type: 'error',
        message: 'Meme ID and valid YouTube URL are required.',
      });
      return;
    }

    setBusy(true);
    try {
      await adminUpsertMemes(
        [{ memeid: cleanId, ytlink: cleanLink, starttime: start, endtime: end }],
        adminKey
      );
      await onCatalogUpdated();
      setMemeYtLink('');
      setMemeStart('0');
      setMemeEnd('0');
      setStatusBanner({
        type: 'success',
        message: `Saved meme "${cleanId}" to Google Sheet.`,
      });
    } catch (err) {
      setStatusBanner({
        type: 'error',
        message: err instanceof Error ? err.message : 'Failed to save meme.',
      });
    } finally {
      setBusy(false);
    }
  };

  const handleCreatePuzzle = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatusBanner(null);
    const id = Math.floor(Number(puzzleId));
    const linkid = puzzleLinkId.trim().toUpperCase();
    const answer = puzzleAnswer.trim();

    if (!id || id < 1 || id > 10000) {
      setStatusBanner({ type: 'error', message: 'Puzzle ID must be between 1 and 10000.' });
      return;
    }
    if (!linkid || !answer) {
      setStatusBanner({ type: 'error', message: 'Link ID and Answer are required.' });
      return;
    }
    if (!puzzlePython.trim() && !puzzleCpp.trim()) {
      setStatusBanner({
        type: 'error',
        message: 'Provide either Python or C++ puzzle code.',
      });
      return;
    }

    const nextIds = puzzleNextIds
      .split(/[,|\s]+/)
      .map((s) => Math.floor(Number(s)))
      .filter((n) => !Number.isNaN(n) && n > 0);

    const hintTrim = puzzleHint.trim();
    const puzzle: Puzzle = {
      id,
      linkid,
      badgeId: Number(puzzleBadgeId) > 0 ? Math.floor(Number(puzzleBadgeId)) : undefined,
      questionPython: puzzlePython,
      questionCpp: puzzleCpp,
      answer,
      nextPuzzleId: nextIds,
      startCode: puzzleStartCode.trim() ? puzzleStartCode.trim().toUpperCase() : undefined,
      locationClue: puzzleLocation.trim() || 'Campus Signal Node',
      level: Math.max(1, Math.min(10, Math.floor(Number(puzzleLevel || 1)))),
      points: Math.max(0, Number(puzzlePoints || 10)),
      hint: hintTrim || undefined,
      hasHint: Boolean(hintTrim),
      hintPenalty: Math.max(0, Math.floor(Number(puzzleHintPenalty || 60))),
      pokemonId: Math.max(0, Math.floor(Number(puzzlePokemonId || 25))),
      pokemonName: puzzlePokemonName.trim() || 'Pikachu',
    };

    setBusy(true);
    try {
      await adminUpsertPuzzles([puzzle], adminKey);
      await onCatalogUpdated();
      setPuzzleAnswer('');
      setPuzzleHint('');
      setPuzzlePython('');
      setPuzzleCpp('');
      setPuzzleStartCode('');
      setPuzzleLocation('');
      setPuzzleNextIds('');
      setStatusBanner({
        type: 'success',
        message: `Saved Puzzle #${id} (${linkid}) to Google Sheet.`,
      });
    } catch (err) {
      setStatusBanner({
        type: 'error',
        message: err instanceof Error ? err.message : 'Failed to save puzzle.',
      });
    } finally {
      setBusy(false);
    }
  };

  // Excel Upload & Bulk Import
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setStatusBanner(null);
    setBulkFilename(file.name);

    try {
      if (mode === 'TEAM') {
        const res = await parseTeamsSpreadsheet(file);
        setBulkTeams(res);
      } else if (mode === 'MEME') {
        const res = await parseMemesSpreadsheet(file);
        setBulkMemes(res);
      } else {
        const res = await parsePuzzlesSpreadsheet(file);
        setBulkPuzzles(res);
      }
    } catch (err) {
      setStatusBanner({
        type: 'error',
        message: err instanceof Error ? err.message : 'Failed to parse spreadsheet.',
      });
      clearBulkPreview();
    }
  };

  const handleBulkImport = async () => {
    setBusy(true);
    setStatusBanner(null);
    try {
      let imported = 0;
      if (mode === 'TEAM' && bulkTeams?.valid.length) {
        imported = await adminUpsertTeams(bulkTeams.valid, adminKey);
      } else if (mode === 'MEME' && bulkMemes?.valid.length) {
        imported = await adminUpsertMemes(bulkMemes.valid, adminKey);
      } else if (mode === 'PUZZLE' && bulkPuzzles?.valid.length) {
        imported = await adminUpsertPuzzles(bulkPuzzles.valid, adminKey);
      }
      await onCatalogUpdated();
      clearBulkPreview();
      setStatusBanner({
        type: 'success',
        message: `Bulk imported ${imported} ${mode.toLowerCase()}(s) into Google Sheet.`,
      });
    } catch (err) {
      setStatusBanner({
        type: 'error',
        message: err instanceof Error ? err.message : 'Bulk import failed.',
      });
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteCloudItem = async (key: string, action: () => Promise<void>) => {
    if (confirmDeleteKey !== key) {
      setConfirmDeleteKey(key);
      return;
    }
    setConfirmDeleteKey(null);
    setBusy(true);
    setStatusBanner(null);
    try {
      await action();
      await onCatalogUpdated();
      setStatusBanner({
        type: 'success',
        message: `Deleted record "${key}" from Google Sheet.`,
      });
    } catch (err) {
      setStatusBanner({
        type: 'error',
        message: err instanceof Error ? err.message : 'Delete failed.',
      });
    } finally {
      setBusy(false);
    }
  };

  const activeBulk = mode === 'TEAM' ? bulkTeams : mode === 'MEME' ? bulkMemes : bulkPuzzles;
  const searchLower = catalogSearch.trim().toLowerCase();

  const filteredTeams = useMemo(() => {
    if (!searchLower) return teams;
    return teams.filter(
      (t) =>
        t.team.toLowerCase().includes(searchLower) ||
        t.tid.toLowerCase().includes(searchLower) ||
        (t.team_members || []).some((m) => m.toLowerCase().includes(searchLower))
    );
  }, [teams, searchLower]);

  const filteredMemes = useMemo(() => {
    if (!searchLower) return memes;
    return memes.filter(
      (m) =>
        m.memeid.toLowerCase().includes(searchLower) ||
        m.ytlink.toLowerCase().includes(searchLower)
    );
  }, [memes, searchLower]);

  const filteredPuzzles = useMemo(() => {
    if (!searchLower) return puzzles;
    return puzzles.filter(
      (p) =>
        String(p.id).includes(searchLower) ||
        p.linkid.toLowerCase().includes(searchLower) ||
        p.locationClue.toLowerCase().includes(searchLower) ||
        p.pokemonName.toLowerCase().includes(searchLower)
    );
  }, [puzzles, searchLower]);

  const CATALOG_PAGE_SIZE = 50;
  const activeFilteredCount =
    mode === 'TEAM'
      ? filteredTeams.length
      : mode === 'MEME'
        ? filteredMemes.length
        : filteredPuzzles.length;
  const totalCatalogPages = Math.max(1, Math.ceil(activeFilteredCount / CATALOG_PAGE_SIZE));
  const safeCatalogPage = Math.min(Math.max(1, catalogPage), totalCatalogPages);
  const catalogStartIdx = (safeCatalogPage - 1) * CATALOG_PAGE_SIZE;

  const pagedTeams = useMemo(
    () => filteredTeams.slice(catalogStartIdx, catalogStartIdx + CATALOG_PAGE_SIZE),
    [filteredTeams, catalogStartIdx]
  );
  const pagedMemes = useMemo(
    () => filteredMemes.slice(catalogStartIdx, catalogStartIdx + CATALOG_PAGE_SIZE),
    [filteredMemes, catalogStartIdx]
  );
  const pagedPuzzles = useMemo(
    () => filteredPuzzles.slice(catalogStartIdx, catalogStartIdx + CATALOG_PAGE_SIZE),
    [filteredPuzzles, catalogStartIdx]
  );

  return (
    <div className="p-4 sm:p-6 space-y-6 overflow-y-auto flex-1 bg-slate-900/20">
      {/* Mode Switcher */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-4">
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => handleModeSwitch('TEAM')}
            className={`px-3.5 py-2 rounded-lg text-xs font-mono font-bold flex items-center gap-2 border transition-all ${
              mode === 'TEAM'
                ? 'bg-indigo-600 text-white border-indigo-400 shadow-lg shadow-indigo-500/20'
                : 'bg-slate-900/60 text-slate-400 border-slate-800 hover:text-white'
            }`}
          >
            <Users className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
            <span>TEAMS ({teams.length})</span>
          </button>
          <button
            type="button"
            onClick={() => handleModeSwitch('MEME')}
            className={`px-3.5 py-2 rounded-lg text-xs font-mono font-bold flex items-center gap-2 border transition-all ${
              mode === 'MEME'
                ? 'bg-cyan-600 text-white border-cyan-400 shadow-lg shadow-cyan-500/20'
                : 'bg-slate-900/60 text-slate-400 border-slate-800 hover:text-white'
            }`}
          >
            <Film className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
            <span>MEMES ({memes.length})</span>
          </button>
          <button
            type="button"
            onClick={() => handleModeSwitch('PUZZLE')}
            className={`px-3.5 py-2 rounded-lg text-xs font-mono font-bold flex items-center gap-2 border transition-all ${
              mode === 'PUZZLE'
                ? 'bg-emerald-600 text-white border-emerald-400 shadow-lg shadow-emerald-500/20'
                : 'bg-slate-900/60 text-slate-400 border-slate-800 hover:text-white'
            }`}
          >
            <PuzzleIcon className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
            <span>PUZZLES ({puzzles.length})</span>
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => {
              if (mode === 'TEAM') downloadTeamsTemplateXlsx();
              else if (mode === 'MEME') downloadMemesTemplateXlsx();
              else downloadPuzzlesTemplateXlsx();
            }}
            className="px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 font-mono text-[11px] font-bold flex items-center gap-1.5 transition-colors"
          >
            <Download className="w-3.5 h-3.5 text-amber-400" />
            <span>SAMPLE TEMPLATE (.XLSX)</span>
          </button>
          <button
            type="button"
            onClick={() => {
              if (mode === 'TEAM') exportTeamsToXlsx(teams);
              else if (mode === 'MEME') exportMemesToXlsx(memes);
              else exportPuzzlesToXlsx(puzzles);
            }}
            className="px-3 py-2 rounded-lg bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/30 text-emerald-300 font-mono text-[11px] font-bold flex items-center gap-1.5 transition-colors"
          >
            <FileSpreadsheet className="w-3.5 h-3.5" />
            <span>EXPORT {mode}S (.XLSX)</span>
          </button>
          <button
            type="button"
            onClick={handleExportJson}
            className="px-3 py-2 rounded-lg bg-indigo-500/10 hover:bg-indigo-500/20 border border-indigo-500/30 text-indigo-300 font-mono text-[11px] font-bold flex items-center gap-1.5 transition-colors"
          >
            <Download className="w-3.5 h-3.5" />
            <span>EXPORT .JSON</span>
          </button>
        </div>
      </div>

      {/* Feedback Banner */}
      {statusBanner && (
        <div
          className={`flex items-center justify-between gap-3 rounded-lg border px-4 py-3 font-mono text-xs ${
            statusBanner.type === 'success'
              ? 'bg-emerald-950/60 border-emerald-500/40 text-emerald-300'
              : 'bg-red-950/60 border-red-500/40 text-red-300'
          }`}
        >
          <div className="flex items-center gap-2">
            {statusBanner.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 shrink-0" />
            ) : (
              <XCircle className="w-4 h-4 shrink-0" />
            )}
            <span>{statusBanner.message}</span>
          </div>
          <button
            type="button"
            onClick={() => setStatusBanner(null)}
            className="text-slate-400 hover:text-white text-[11px]"
          >
            DISMISS
          </button>
        </div>
      )}

      {/* Forms + Excel Bulk Grid */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-5">
        {/* Left: Single Entry Creator */}
        <div className="xl:col-span-7 bg-slate-950/60 border border-slate-800 rounded-xl p-4 sm:p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-mono text-xs font-bold uppercase tracking-wider text-indigo-300 flex items-center gap-2">
              <Plus className="w-4 h-4" />
              <span>
                {mode === 'TEAM'
                  ? 'Create / Update Team'
                  : mode === 'MEME'
                    ? 'Create / Update Meme QR'
                    : 'Create / Update Puzzle Node'}
              </span>
            </h3>
            <span className="text-[10px] font-mono text-slate-500 flex items-center gap-1">
              <Database className="w-3 h-3 text-emerald-400" />
              JSON + SHEETS SYNC
            </span>
          </div>

          {mode === 'TEAM' && (
            <form onSubmit={handleCreateTeam} className="space-y-3.5">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-[10px] font-mono uppercase text-slate-400 mb-1">
                    Team ID (TID) *
                  </label>
                  <input
                    type="text"
                    value={teamTid}
                    onChange={(e) => setTeamTid(e.target.value.toUpperCase())}
                    placeholder="T051"
                    maxLength={32}
                    required
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs font-mono text-white focus:outline-none focus:border-indigo-500"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-[10px] font-mono uppercase text-slate-400 mb-1">
                    Team Name *
                  </label>
                  <input
                    type="text"
                    value={teamName}
                    onChange={(e) => setTeamName(e.target.value)}
                    placeholder="e.g. PIKA SQUAD"
                    maxLength={60}
                    required
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs font-mono text-white focus:outline-none focus:border-indigo-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-[10px] font-mono uppercase text-slate-400 mb-1">
                    Security Key *
                  </label>
                  <input
                    type="text"
                    value={teamKey}
                    onChange={(e) => setTeamKey(e.target.value)}
                    placeholder="e.g. PIKA123"
                    maxLength={64}
                    required
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs font-mono text-white focus:outline-none focus:border-indigo-500"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-[10px] font-mono uppercase text-slate-400 mb-1">
                    Team Members (comma separated)
                  </label>
                  <input
                    type="text"
                    value={teamMembersText}
                    onChange={(e) => setTeamMembersText(e.target.value)}
                    placeholder="Ash, Misty, Brock, Pikachu"
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs font-mono text-white focus:outline-none focus:border-indigo-500"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={busy}
                className="w-full sm:w-auto px-5 py-2.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-mono text-xs font-bold flex items-center justify-center gap-2 transition-colors"
              >
                <Plus className="w-4 h-4" />
                <span>{busy ? 'SAVING...' : 'SAVE TEAM TO SHEET'}</span>
              </button>
            </form>
          )}

          {mode === 'MEME' && (
            <form onSubmit={handleCreateMeme} className="space-y-3.5">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-[10px] font-mono uppercase text-slate-400 mb-1">
                    Meme ID *
                  </label>
                  <input
                    type="text"
                    value={memeId}
                    onChange={(e) => setMemeId(e.target.value.toUpperCase())}
                    placeholder="M03"
                    maxLength={32}
                    required
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs font-mono text-white focus:outline-none focus:border-cyan-500"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-mono uppercase text-slate-400 mb-1">
                    Start Time (sec)
                  </label>
                  <input
                    type="number"
                    min={0}
                    max={86400}
                    value={memeStart}
                    onChange={(e) => setMemeStart(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs font-mono text-white focus:outline-none focus:border-cyan-500"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-mono uppercase text-slate-400 mb-1">
                    End Time (0 = full)
                  </label>
                  <input
                    type="number"
                    min={0}
                    max={86400}
                    value={memeEnd}
                    onChange={(e) => setMemeEnd(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs font-mono text-white focus:outline-none focus:border-cyan-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[10px] font-mono uppercase text-slate-400 mb-1">
                  YouTube Link (Watch / Shorts / youtu.be) *
                </label>
                <input
                  type="url"
                  value={memeYtLink}
                  onChange={(e) => setMemeYtLink(e.target.value)}
                  placeholder="https://youtube.com/shorts/..."
                  maxLength={512}
                  required
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs font-mono text-white focus:outline-none focus:border-cyan-500"
                />
              </div>

              <button
                type="submit"
                disabled={busy}
                className="w-full sm:w-auto px-5 py-2.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-white font-mono text-xs font-bold flex items-center justify-center gap-2 transition-colors"
              >
                <Plus className="w-4 h-4" />
                <span>{busy ? 'SAVING...' : 'SAVE MEME TO SHEET'}</span>
              </button>
            </form>
          )}

          {mode === 'PUZZLE' && (
            <form onSubmit={handleCreatePuzzle} className="space-y-3">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                <div>
                  <label className="block text-[10px] font-mono uppercase text-slate-400 mb-1">
                    Puzzle ID *
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={10000}
                    value={puzzleId}
                    onChange={(e) => setPuzzleId(e.target.value)}
                    required
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-2 text-xs font-mono text-white focus:outline-none focus:border-emerald-500"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-mono uppercase text-slate-400 mb-1">
                    QR Link ID *
                  </label>
                  <input
                    type="text"
                    value={puzzleLinkId}
                    onChange={(e) => setPuzzleLinkId(e.target.value.toUpperCase())}
                    placeholder="XG21"
                    maxLength={32}
                    required
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-2 text-xs font-mono text-white focus:outline-none focus:border-emerald-500"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-mono uppercase text-slate-400 mb-1">
                    Level
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={10}
                    value={puzzleLevel}
                    onChange={(e) => setPuzzleLevel(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-2 text-xs font-mono text-white focus:outline-none focus:border-emerald-500"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-mono uppercase text-slate-400 mb-1">
                    Points
                  </label>
                  <input
                    type="number"
                    min={0}
                    max={10000}
                    value={puzzlePoints}
                    onChange={(e) => setPuzzlePoints(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-2 text-xs font-mono text-white focus:outline-none focus:border-emerald-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                <div>
                  <label className="block text-[10px] font-mono uppercase text-slate-400 mb-1">
                    Expected Answer *
                  </label>
                  <input
                    type="text"
                    value={puzzleAnswer}
                    onChange={(e) => setPuzzleAnswer(e.target.value)}
                    placeholder="e.g. 14"
                    maxLength={256}
                    required
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-2 text-xs font-mono text-white focus:outline-none focus:border-emerald-500"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-mono uppercase text-slate-400 mb-1">
                    Next Puzzle IDs
                  </label>
                  <input
                    type="text"
                    value={puzzleNextIds}
                    onChange={(e) => setPuzzleNextIds(e.target.value)}
                    placeholder="e.g. 22, 23"
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-2 text-xs font-mono text-white focus:outline-none focus:border-emerald-500"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-mono uppercase text-slate-400 mb-1">
                    Start Code (opt)
                  </label>
                  <input
                    type="text"
                    value={puzzleStartCode}
                    onChange={(e) => setPuzzleStartCode(e.target.value.toUpperCase())}
                    placeholder="e.g. START"
                    maxLength={64}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-2 text-xs font-mono text-white focus:outline-none focus:border-emerald-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-4 gap-2.5">
                <div className="sm:col-span-2">
                  <label className="block text-[10px] font-mono uppercase text-slate-400 mb-1">
                    Location Clue
                  </label>
                  <input
                    type="text"
                    value={puzzleLocation}
                    onChange={(e) => setPuzzleLocation(e.target.value)}
                    placeholder="e.g. Library Main Steps"
                    maxLength={500}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-2 text-xs font-mono text-white focus:outline-none focus:border-emerald-500"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-mono uppercase text-slate-400 mb-1">
                    Pokémon ID
                  </label>
                  <input
                    type="number"
                    min={0}
                    max={10000}
                    value={puzzlePokemonId}
                    onChange={(e) => setPuzzlePokemonId(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-2 text-xs font-mono text-white focus:outline-none focus:border-emerald-500"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-mono uppercase text-slate-400 mb-1">
                    Pokémon Name
                  </label>
                  <input
                    type="text"
                    value={puzzlePokemonName}
                    onChange={(e) => setPuzzlePokemonName(e.target.value)}
                    placeholder="Pikachu"
                    maxLength={80}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-2 text-xs font-mono text-white focus:outline-none focus:border-emerald-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-4 gap-2.5">
                <div className="sm:col-span-2">
                  <label className="block text-[10px] font-mono uppercase text-slate-400 mb-1">
                    Hint (optional)
                  </label>
                  <input
                    type="text"
                    value={puzzleHint}
                    onChange={(e) => setPuzzleHint(e.target.value)}
                    placeholder="Optional Brock hint..."
                    maxLength={1000}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-2 text-xs font-mono text-white focus:outline-none focus:border-emerald-500"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-mono uppercase text-slate-400 mb-1">
                    Hint Wait (sec)
                  </label>
                  <input
                    type="number"
                    min={0}
                    max={3600}
                    value={puzzleHintPenalty}
                    onChange={(e) => setPuzzleHintPenalty(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-2 text-xs font-mono text-white focus:outline-none focus:border-emerald-500"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-mono uppercase text-slate-400 mb-1">
                    Badge ID (0=none)
                  </label>
                  <input
                    type="number"
                    min={0}
                    max={10000}
                    value={puzzleBadgeId}
                    onChange={(e) => setPuzzleBadgeId(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-2 text-xs font-mono text-white focus:outline-none focus:border-emerald-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] font-mono uppercase text-slate-400 mb-1">
                    Python Snippet
                  </label>
                  <textarea
                    rows={4}
                    value={puzzlePython}
                    onChange={(e) => setPuzzlePython(e.target.value)}
                    placeholder={'x = 5\nprint(x * 2)'}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2.5 text-xs font-mono text-emerald-300 focus:outline-none focus:border-emerald-500"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-mono uppercase text-slate-400 mb-1">
                    C++ Snippet
                  </label>
                  <textarea
                    rows={4}
                    value={puzzleCpp}
                    onChange={(e) => setPuzzleCpp(e.target.value)}
                    placeholder={'#include <iostream>\nusing namespace std;\nint main(){ cout << 10; }'}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2.5 text-xs font-mono text-cyan-300 focus:outline-none focus:border-emerald-500"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={busy}
                className="w-full sm:w-auto px-5 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-mono text-xs font-bold flex items-center justify-center gap-2 transition-colors"
              >
                <Plus className="w-4 h-4" />
                <span>{busy ? 'SAVING...' : 'SAVE PUZZLE TO SHEET'}</span>
              </button>
            </form>
          )}
        </div>

        {/* Right: Excel Bulk Uploader */}
        <div className="xl:col-span-5 bg-slate-950/60 border border-slate-800 rounded-xl p-4 sm:p-5 flex flex-col justify-between gap-4">
          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-mono text-xs font-bold uppercase tracking-wider text-amber-300 flex items-center gap-2">
                <FileSpreadsheet className="w-4 h-4" />
                <span>Bulk Upload via Excel</span>
              </h3>
              <span className="text-[10px] font-mono text-slate-500">.XLSX / .XLS / .CSV</span>
            </div>

            <label className="flex flex-col items-center justify-center border-2 border-dashed border-slate-700 hover:border-amber-500/60 rounded-xl p-5 bg-slate-900/50 cursor-pointer transition-colors text-center">
              <Upload className="w-6 h-6 sm:w-8 sm:h-8 text-amber-400 mb-2" />
              <span className="font-mono text-xs font-bold text-slate-200">
                {bulkFilename || `Select ${mode} Excel / CSV file`}
              </span>
              <span className="font-mono text-[10px] text-slate-400 mt-1">
                Download sample template above for exact columns
              </span>
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xls,.csv"
                onChange={(e) => void handleFileChange(e)}
                className="sr-only"
              />
            </label>

            {activeBulk && (
              <div className="mt-4 space-y-3">
                <div className="flex items-center justify-between text-xs font-mono bg-slate-900 rounded-lg px-3 py-2 border border-slate-800">
                  <span className="text-emerald-400 font-bold">
                    Valid: {activeBulk.valid.length} / {activeBulk.rawCount}
                  </span>
                  {activeBulk.errors.length > 0 && (
                    <span className="text-red-400 font-bold">
                      Errors: {activeBulk.errors.length}
                    </span>
                  )}
                </div>

                {activeBulk.errors.length > 0 && (
                  <div className="max-h-24 overflow-y-auto rounded-lg bg-red-950/40 border border-red-500/30 p-2.5 text-[10px] font-mono text-red-300 space-y-1">
                    {activeBulk.errors.slice(0, 8).map((err, i) => (
                      <div key={i}>
                        Row {err.row}: {err.reason}
                      </div>
                    ))}
                  </div>
                )}

                {activeBulk.valid.length > 0 && (
                  <div className="max-h-40 overflow-y-auto rounded-lg bg-slate-900/80 border border-slate-800 divide-y divide-slate-800 text-[10px] font-mono">
                    {mode === 'TEAM' &&
                      (bulkTeams?.valid || []).slice(0, 6).map((t) => (
                        <div key={t.tid} className="px-3 py-1.5 flex justify-between gap-2">
                          <span className="text-blue-400 font-bold">{t.tid}</span>
                          <span className="text-slate-200 truncate flex-1">{t.team}</span>
                          <span className="text-slate-400">{t.securityKey}</span>
                        </div>
                      ))}
                    {mode === 'MEME' &&
                      (bulkMemes?.valid || []).slice(0, 6).map((m) => (
                        <div key={m.memeid} className="px-3 py-1.5 flex justify-between gap-2">
                          <span className="text-cyan-400 font-bold">{m.memeid}</span>
                          <span className="text-slate-300 truncate flex-1">{m.ytlink}</span>
                          <span className="text-slate-400">
                            {m.starttime}-{m.endtime}s
                          </span>
                        </div>
                      ))}
                    {mode === 'PUZZLE' &&
                      (bulkPuzzles?.valid || []).slice(0, 6).map((p) => (
                        <div key={p.id} className="px-3 py-1.5 flex justify-between gap-2">
                          <span className="text-emerald-400 font-bold">
                            P{p.id} ({p.linkid})
                          </span>
                          <span className="text-slate-300 truncate flex-1">{p.locationClue}</span>
                          <span className="text-amber-300">Ans: {p.answer}</span>
                        </div>
                      ))}
                    {activeBulk.valid.length > 6 && (
                      <div className="px-3 py-1.5 text-center text-slate-500">
                        +{activeBulk.valid.length - 6} more ready rows...
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="flex gap-2">
            <button
              type="button"
              disabled={busy || !activeBulk?.valid.length}
              onClick={() => void handleBulkImport()}
              className="flex-1 py-2.5 rounded-lg bg-amber-500 hover:bg-amber-400 disabled:opacity-40 text-slate-950 font-mono text-xs font-extrabold transition-colors"
            >
              {busy
                ? 'IMPORTING...'
                : `IMPORT ${activeBulk?.valid.length || 0} ${mode}S TO SHEET`}
            </button>
            {activeBulk && (
              <button
                type="button"
                disabled={busy}
                onClick={clearBulkPreview}
                className="px-3 py-2.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 font-mono text-xs font-bold"
              >
                CLEAR
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Live Catalog Table */}
      <div className="bg-slate-950/60 border border-slate-800 rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-800 flex flex-wrap items-center justify-between gap-3 bg-slate-900/50">
          <h4 className="font-mono text-xs font-bold text-slate-200 uppercase tracking-wider">
            {mode} Catalog ({activeFilteredCount})
          </h4>
          <div className="relative w-full sm:w-64">
            <Search className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={catalogSearch}
              onChange={(e) => {
                setCatalogSearch(e.target.value);
                setCatalogPage(1);
              }}
              placeholder={`Search ${mode.toLowerCase()}s...`}
              className="w-full bg-slate-900 border border-slate-700 rounded-lg pl-8 pr-3 py-1.5 text-xs font-mono text-slate-200 focus:outline-none focus:border-indigo-500"
            />
          </div>
        </div>

        <div className="max-h-80 overflow-y-auto divide-y divide-slate-800/60 font-mono text-xs">
          {activeFilteredCount === 0 && (
            <div className="px-4 py-8 text-center text-slate-500 text-xs">
              No {mode.toLowerCase()} records in Google Sheet yet. Create one above or import an Excel spreadsheet.
            </div>
          )}

          {mode === 'TEAM' &&
            pagedTeams.map((t) => (
              <div
                key={t.tid}
                className="px-4 py-2.5 flex flex-wrap items-center justify-between gap-2 hover:bg-white/5"
              >
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <span className="px-1.5 py-0.5 rounded text-[9px] font-bold border bg-emerald-500/15 text-emerald-300 border-emerald-500/30">
                    DB
                  </span>
                  <span className="text-blue-400 font-bold shrink-0">{t.tid}</span>
                  <span className="text-slate-100 font-bold truncate">{t.team}</span>
                  <span className="text-slate-500 text-[11px] shrink-0">Key: {t.securityKey}</span>
                  <span className="text-emerald-300/80 text-[11px] truncate hidden md:inline">
                    {(t.team_members || []).join(', ')}
                  </span>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => {
                      setTeamTid(t.tid);
                      setTeamName(t.team);
                      setTeamKey(t.securityKey);
                      setTeamMembersText((t.team_members || []).join(', '));
                    }}
                    className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-[10px] text-slate-300"
                  >
                    EDIT
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      void handleDeleteCloudItem(t.tid, () => adminDeleteTeamCatalog(t.tid, adminKey))
                    }
                    className={`px-2 py-1 rounded text-[10px] font-bold flex items-center gap-1 ${
                      confirmDeleteKey === t.tid
                        ? 'bg-red-600 text-white'
                        : 'bg-red-500/10 hover:bg-red-500/20 text-red-400'
                    }`}
                  >
                    <Trash2 className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
                    <span>{confirmDeleteKey === t.tid ? 'CONFIRM?' : 'DEL'}</span>
                  </button>
                </div>
              </div>
            ))}

          {mode === 'MEME' &&
            pagedMemes.map((m) => (
              <div
                key={m.memeid}
                className="px-4 py-2.5 flex flex-wrap items-center justify-between gap-2 hover:bg-white/5"
              >
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <span className="px-1.5 py-0.5 rounded text-[9px] font-bold border bg-emerald-500/15 text-emerald-300 border-emerald-500/30">
                    DB
                  </span>
                  <span className="text-cyan-400 font-bold shrink-0">{m.memeid}</span>
                  <span className="text-slate-300 truncate flex-1 text-[11px]">{m.ytlink}</span>
                  <span className="text-slate-500 text-[10px] shrink-0">
                    {m.starttime}s–{m.endtime || 'end'}s
                  </span>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <a
                    href={`/?memid=${encodeURIComponent(m.memeid)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-2 py-1 rounded bg-cyan-500/10 hover:bg-cyan-500/20 text-[10px] text-cyan-300 flex items-center gap-1"
                  >
                    <span>QR</span>
                    <ExternalLink className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
                  </a>
                  <button
                    type="button"
                    onClick={() => {
                      setMemeId(m.memeid);
                      setMemeYtLink(m.ytlink);
                      setMemeStart(String(m.starttime || 0));
                      setMemeEnd(String(m.endtime || 0));
                    }}
                    className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-[10px] text-slate-300"
                  >
                    EDIT
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      void handleDeleteCloudItem(m.memeid, () => adminDeleteMemeCatalog(m.memeid, adminKey))
                    }
                    className={`px-2 py-1 rounded text-[10px] font-bold flex items-center gap-1 ${
                      confirmDeleteKey === m.memeid
                        ? 'bg-red-600 text-white'
                        : 'bg-red-500/10 hover:bg-red-500/20 text-red-400'
                    }`}
                  >
                    <Trash2 className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
                    <span>{confirmDeleteKey === m.memeid ? 'CONFIRM?' : 'DEL'}</span>
                  </button>
                </div>
              </div>
            ))}

          {mode === 'PUZZLE' &&
            pagedPuzzles.map((p) => (
              <div
                key={p.id}
                className="px-4 py-2.5 flex flex-wrap items-center justify-between gap-2 hover:bg-white/5"
              >
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <span className="px-1.5 py-0.5 rounded text-[9px] font-bold border bg-emerald-500/15 text-emerald-300 border-emerald-500/30">
                    DB
                  </span>
                  <span className="text-emerald-400 font-bold shrink-0">P{p.id}</span>
                  <span className="text-cyan-400 font-bold shrink-0">{p.linkid}</span>
                  <span className="text-slate-400 text-[10px] shrink-0">L{p.level}</span>
                  <span className="text-slate-200 truncate flex-1">{p.locationClue}</span>
                  <span className="text-amber-300 text-[11px] shrink-0">Ans: {p.answer}</span>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <a
                    href={`/?linkid=${encodeURIComponent(p.linkid)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-2 py-1 rounded bg-cyan-500/10 hover:bg-cyan-500/20 text-[10px] text-cyan-300 flex items-center gap-1"
                  >
                    <span>QR</span>
                    <ExternalLink className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
                  </a>
                  <button
                    type="button"
                    onClick={() => {
                      setPuzzleId(String(p.id));
                      setPuzzleLinkId(p.linkid);
                      setPuzzleLevel(String(p.level));
                      setPuzzlePoints(String(p.points));
                      setPuzzleStartCode(p.startCode || '');
                      setPuzzleBadgeId(String(p.badgeId || 0));
                      setPuzzleLocation(p.locationClue || '');
                      setPuzzlePokemonId(String(p.pokemonId || 25));
                      setPuzzlePokemonName(p.pokemonName || 'Pikachu');
                      setPuzzleAnswer(p.answer);
                      setPuzzleHint(typeof p.hint === 'string' ? p.hint : '');
                      setPuzzleHintPenalty(String(p.hintPenalty ?? 60));
                      setPuzzleNextIds((p.nextPuzzleId || []).join(', '));
                      setPuzzlePython(p.questionPython || '');
                      setPuzzleCpp(p.questionCpp || '');
                    }}
                    className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-[10px] text-slate-300"
                  >
                    EDIT
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      void handleDeleteCloudItem(`P${p.id}`, () => adminDeletePuzzleCatalog(p.id, adminKey))
                    }
                    className={`px-2 py-1 rounded text-[10px] font-bold flex items-center gap-1 ${
                      confirmDeleteKey === `P${p.id}`
                        ? 'bg-red-600 text-white'
                        : 'bg-red-500/10 hover:bg-red-500/20 text-red-400'
                    }`}
                  >
                    <Trash2 className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
                    <span>{confirmDeleteKey === `P${p.id}` ? 'CONFIRM?' : 'DEL'}</span>
                  </button>
                </div>
              </div>
            ))}
        </div>

        {totalCatalogPages > 1 && (
          <div className="px-4 py-2.5 border-t border-slate-800 bg-slate-900/40 flex items-center justify-between font-mono text-[11px] text-slate-400">
            <span>
              Showing {catalogStartIdx + 1}–{Math.min(catalogStartIdx + CATALOG_PAGE_SIZE, activeFilteredCount)} of {activeFilteredCount}
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={safeCatalogPage <= 1}
                onClick={() => setCatalogPage((p) => Math.max(1, p - 1))}
                className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-slate-200 flex items-center gap-1"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
                <span>PREV</span>
              </button>
              <span className="text-slate-300">
                {safeCatalogPage} / {totalCatalogPages}
              </span>
              <button
                type="button"
                disabled={safeCatalogPage >= totalCatalogPages}
                onClick={() => setCatalogPage((p) => Math.min(totalCatalogPages, p + 1))}
                className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-slate-200 flex items-center gap-1"
              >
                <span>NEXT</span>
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
